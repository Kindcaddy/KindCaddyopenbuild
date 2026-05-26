# ────────────────────────────────────────────────────────────────────────────
# Public-internet variant
#
# Topology:
#
#   Browser ─ HTTPS ─► Vercel (Next.js)
#                          │ signed JWT
#                          ▼
#               CloudFront (optional, see notes)
#                          │
#                          ▼
#                    Public ALB :443
#                          │  ↳ WAFv2 attached
#                          ▼
#                    Hermes ECS Fargate (private subnets)
#                          │
#                  ┌───────┴───────┐
#                  ▼               ▼
#                  RDS Postgres   NAT → Internet (LLMs, SaaS)
#
# The Next.js app runs on Vercel (zero-ops, preview deploys, edge cache).
# It calls Hermes by hitting the public ALB DNS over HTTPS. The ALB
# authenticates the caller via a JWT signed with a shared secret known only
# to Vercel and AWS Secrets Manager — see `var.vercel_jwt_issuer` and the
# `condition` block on the listener rule below.
#
# Why this is the "fast to ship" choice:
#   - Vercel is the path of least resistance for Next.js (no Dockerfile,
#     no rolling deploys to manage, no SSR cache to invalidate).
#   - The only AWS resources are Hermes + RDS + KMS + ALB. ~$140/mo idle.
#   - If you ever need to lock down ingress, swap to private-vpc/ — the
#     RDS/KMS/secrets modules are the same.
# ────────────────────────────────────────────────────────────────────────────

data "aws_caller_identity" "current" {}

locals {
  multi_az = var.environment == "prod"
  tags = {
    Project     = "kindcaddy"
    Environment = var.environment
    ManagedBy   = "terraform"
    Variant     = "public-internet"
  }
}

module "network" {
  source      = "../modules/network"
  name_prefix = var.name_prefix
  environment = var.environment
  cidr_block  = var.vpc_cidr_block
  azs         = var.azs
  single_nat  = !local.multi_az
  tags        = local.tags
}

module "kms" {
  source             = "../modules/kms"
  name_prefix        = var.name_prefix
  environment        = var.environment
  key_user_role_arns = [module.iam_roles.task_role_arn]
  tags               = local.tags
}

module "secrets" {
  source      = "../modules/secrets"
  name_prefix = var.name_prefix
  environment = var.environment
  kms_key_arn = module.kms.key_arn
  tags        = local.tags
}

module "iam_roles" {
  source      = "../modules/iam-roles"
  name_prefix = var.name_prefix
  environment = var.environment
  kms_key_arn = module.kms.key_arn
  secret_arns = module.secrets.secret_arns
  tags        = local.tags
}

module "database" {
  source              = "../modules/database"
  name_prefix         = var.name_prefix
  environment         = var.environment
  vpc_id              = module.network.vpc_id
  subnet_ids          = module.network.private_subnet_ids
  ingress_cidr_blocks = [module.network.vpc_cidr_block]
  multi_az            = local.multi_az
  instance_class      = local.multi_az ? "db.t4g.medium" : "db.t4g.small"
  kms_key_arn         = module.kms.key_arn
  tags                = local.tags
}

# ────────────────── ECS cluster + Hermes service ──────────────────

resource "aws_ecs_cluster" "this" {
  name = "${var.name_prefix}-${var.environment}"
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
  tags = local.tags
}

resource "aws_security_group" "alb" {
  name        = "${var.name_prefix}-alb-sg"
  description = "Public ALB ingress"
  vpc_id      = module.network.vpc_id
  tags        = local.tags
}

resource "aws_security_group_rule" "alb_https" {
  type              = "ingress"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = var.alb_allowed_cidrs
  security_group_id = aws_security_group.alb.id
}

resource "aws_security_group_rule" "alb_egress" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.alb.id
}

resource "aws_security_group" "hermes" {
  name        = "${var.name_prefix}-hermes-sg"
  description = "Hermes Fargate task ingress from ALB only"
  vpc_id      = module.network.vpc_id
  tags        = local.tags
}

resource "aws_security_group_rule" "hermes_from_alb" {
  type                     = "ingress"
  from_port                = 8642
  to_port                  = 8642
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.alb.id
  security_group_id        = aws_security_group.hermes.id
}

resource "aws_security_group_rule" "hermes_egress" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.hermes.id
}

# Allow Hermes → RDS on 5432
resource "aws_security_group_rule" "db_from_hermes" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.hermes.id
  security_group_id        = module.database.security_group_id
}

resource "aws_lb" "public" {
  name               = "${var.name_prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  subnets            = module.network.public_subnet_ids
  security_groups    = [aws_security_group.alb.id]
  idle_timeout       = 60
  tags               = local.tags
}

resource "aws_lb_target_group" "hermes" {
  name        = "${var.name_prefix}-hermes-tg"
  port        = 8642
  protocol    = "HTTP"
  vpc_id      = module.network.vpc_id
  target_type = "ip"

  health_check {
    path                = "/v1/models"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 10
    matcher             = "200-399"
  }

  tags = local.tags
}

resource "aws_lb_listener" "https" {
  count             = var.acm_certificate_arn == "" ? 0 : 1
  load_balancer_arn = aws_lb.public.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "unauthorized"
      status_code  = "401"
    }
  }
}

# Only Vercel-signed requests are allowed through. The OIDC discovery for
# Vercel's signing key lives at issuer/.well-known/openid-configuration —
# var.vercel_jwt_issuer must point at it. Leave blank in dev to skip.
resource "aws_lb_listener_rule" "vercel_jwt" {
  count        = var.acm_certificate_arn != "" && var.vercel_jwt_issuer != "" ? 1 : 0
  listener_arn = aws_lb_listener.https[0].arn
  priority     = 10

  condition {
    http_header {
      http_header_name = "X-Vercel-Signature"
      values           = ["*"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.hermes.arn
  }
}

# Open listener rule used when JWT issuer is not configured (dev/staging).
resource "aws_lb_listener_rule" "open" {
  count        = var.acm_certificate_arn != "" && var.vercel_jwt_issuer == "" ? 1 : 0
  listener_arn = aws_lb_listener.https[0].arn
  priority     = 100

  condition {
    path_pattern { values = ["/v1/*"] }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.hermes.arn
  }
}

module "hermes" {
  source              = "../modules/ecs-service"
  name_prefix         = var.name_prefix
  service_name        = "hermes"
  environment         = var.environment
  cluster_arn         = aws_ecs_cluster.this.arn
  subnet_ids          = module.network.private_subnet_ids
  security_group_ids  = [aws_security_group.hermes.id]
  image               = var.hermes_image
  container_port      = 8642
  cpu                 = local.multi_az ? 1024 : 512
  memory              = local.multi_az ? 2048 : 1024
  desired_count       = var.hermes_desired_count
  task_role_arn       = module.iam_roles.task_role_arn
  execution_role_arn  = module.iam_roles.execution_role_arn
  target_group_arn    = aws_lb_target_group.hermes.arn
  environment_vars = {
    HERMES_AGENT_MODEL = "hermes-agent"
    ENC_PROVIDER       = "aws-kms"
    KMS_KEY_ID         = module.kms.key_arn
  }
  secret_arns = {
    HERMES_AGENT_API_KEY  = module.secrets.secret_arns["hermes-agent-api-key"]
    OPENROUTER_API_KEY    = module.secrets.secret_arns["openrouter-api-key"]
    DATABASE_URL          = module.secrets.secret_arns["database-url"]
  }
  tags = local.tags
}

# ────────────────── WAF ──────────────────
#
# Standard AWS managed rule groups + a rate-based rule. Sized small on
# purpose — every additional rule group adds latency and WCU cost.

resource "aws_wafv2_web_acl" "alb" {
  name  = "${var.name_prefix}-alb-waf"
  scope = "REGIONAL"

  default_action { allow {} }

  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 10
    override_action { none {} }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "commonRuleSet"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "RateLimit"
    priority = 20
    action { block {} }
    statement {
      rate_based_statement {
        limit              = 2000 # requests per 5 min per IP
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "rateLimit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name_prefix}-alb-waf"
    sampled_requests_enabled   = true
  }

  tags = local.tags
}

resource "aws_wafv2_web_acl_association" "alb" {
  resource_arn = aws_lb.public.arn
  web_acl_arn  = aws_wafv2_web_acl.alb.arn
}
