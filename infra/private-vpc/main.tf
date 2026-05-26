# ────────────────────────────────────────────────────────────────────────────
# Private-VPC variant
#
# Topology:
#
#   Corporate network / VPN ─► Internal ALB :443 (no public IP)
#                                     │
#                  ┌──────────────────┼──────────────────┐
#                  ▼                                     ▼
#         Next.js ECS Fargate  ── intra-VPC ──►  Hermes ECS Fargate
#                  │                                     │
#                  ▼                                     ▼
#         RDS Postgres (private)              External LLMs / SaaS
#                                            (via NAT or VPC endpoints)
#
# What's intentionally different from public-internet/:
#   - The ALB is `internal = true`. It has no public DNS A record and no
#     public IP allocations. It is reachable only from inside the VPC and
#     anything peered/attached to it.
#   - The Next.js app runs as a second ECS service on the same cluster.
#     Vercel is not in the picture. This is the "no traffic leaves AWS"
#     posture some enterprise / regulated customers require.
#   - Optional VPC endpoints (var.use_vpc_endpoints) replace NAT for AWS API
#     calls. Useful if you want zero outbound internet from the tasks. LLM
#     egress will still need NAT unless you proxy through Bedrock — see
#     comment in `data_egress.tf` (omitted; document the option).
#   - WAF is omitted because the ALB is internal — your perimeter is the
#     corporate firewall, not WAF.
# ────────────────────────────────────────────────────────────────────────────

data "aws_caller_identity" "current" {}

locals {
  multi_az = var.environment == "prod"
  tags = {
    Project     = "kindcaddy"
    Environment = var.environment
    ManagedBy   = "terraform"
    Variant     = "private-vpc"
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

# ────────────────── ECS cluster ──────────────────

resource "aws_ecs_cluster" "this" {
  name = "${var.name_prefix}-${var.environment}"
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
  tags = local.tags
}

# ────────────────── Internal ALB ──────────────────

resource "aws_security_group" "alb" {
  name        = "${var.name_prefix}-internal-alb-sg"
  description = "Internal ALB ingress (intranet only)"
  vpc_id      = module.network.vpc_id
  tags        = local.tags
}

resource "aws_security_group_rule" "alb_https_internal" {
  type              = "ingress"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = var.trusted_cidr_blocks
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

resource "aws_lb" "internal" {
  name               = "${var.name_prefix}-internal-alb"
  internal           = true
  load_balancer_type = "application"
  subnets            = module.network.private_subnet_ids
  security_groups    = [aws_security_group.alb.id]
  idle_timeout       = 60
  tags               = local.tags
}

# ────────────────── App (Next.js) service ──────────────────

resource "aws_security_group" "app" {
  name        = "${var.name_prefix}-app-sg"
  description = "Next.js Fargate ingress from internal ALB only"
  vpc_id      = module.network.vpc_id
  tags        = local.tags
}

resource "aws_security_group_rule" "app_from_alb" {
  type                     = "ingress"
  from_port                = 3000
  to_port                  = 3000
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.alb.id
  security_group_id        = aws_security_group.app.id
}

resource "aws_security_group_rule" "app_egress" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.app.id
}

resource "aws_lb_target_group" "app" {
  name        = "${var.name_prefix}-app-tg"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = module.network.vpc_id
  target_type = "ip"
  health_check {
    path                = "/api/me"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 10
    matcher             = "200,401" # 401 is fine — it proves the app is up, just unauthenticated
  }
  tags = local.tags
}

# Default route serves the app
resource "aws_lb_listener" "https" {
  count             = var.internal_acm_certificate_arn == "" ? 0 : 1
  load_balancer_arn = aws_lb.internal.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.internal_acm_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

# Hermes lives behind /v1/* on the same ALB. This is a deliberate choice:
# one DNS name, one cert, simpler reverse-proxy config. The split happens
# at the listener-rule layer.
resource "aws_lb_listener_rule" "hermes" {
  count        = var.internal_acm_certificate_arn == "" ? 0 : 1
  listener_arn = aws_lb_listener.https[0].arn
  priority     = 10
  condition {
    path_pattern { values = ["/v1/*"] }
  }
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.hermes.arn
  }
}

module "app" {
  source              = "../modules/ecs-service"
  name_prefix         = var.name_prefix
  service_name        = "app"
  environment         = var.environment
  cluster_arn         = aws_ecs_cluster.this.arn
  subnet_ids          = module.network.private_subnet_ids
  security_group_ids  = [aws_security_group.app.id]
  image               = var.app_image
  container_port      = 3000
  cpu                 = local.multi_az ? 1024 : 512
  memory              = local.multi_az ? 2048 : 1024
  desired_count       = var.app_desired_count
  task_role_arn       = module.iam_roles.task_role_arn
  execution_role_arn  = module.iam_roles.execution_role_arn
  target_group_arn    = aws_lb_target_group.app.arn
  environment_vars = {
    NODE_ENV               = "production"
    ENC_PROVIDER           = "aws-kms"
    KMS_KEY_ID             = module.kms.key_arn
    HERMES_AGENT_BASE_URL  = "https://${aws_lb.internal.dns_name}/v1"
    HERMES_AGENT_MODEL     = "hermes-agent"
  }
  secret_arns = {
    DATABASE_URL             = module.secrets.secret_arns["database-url"]
    HERMES_AGENT_API_KEY     = module.secrets.secret_arns["hermes-agent-api-key"]
    GOOGLE_CLIENT_ID         = module.secrets.secret_arns["google-client-id"]
    GOOGLE_CLIENT_SECRET     = module.secrets.secret_arns["google-client-secret"]
    QUICKBOOKS_CLIENT_ID     = module.secrets.secret_arns["quickbooks-client-id"]
    QUICKBOOKS_CLIENT_SECRET = module.secrets.secret_arns["quickbooks-client-secret"]
  }
  tags = local.tags
}

# ────────────────── Hermes service ──────────────────

resource "aws_security_group" "hermes" {
  name        = "${var.name_prefix}-hermes-sg"
  description = "Hermes Fargate ingress from app + ALB"
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

resource "aws_security_group_rule" "hermes_from_app" {
  type                     = "ingress"
  from_port                = 8642
  to_port                  = 8642
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.app.id
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

resource "aws_security_group_rule" "db_from_app" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.app.id
  security_group_id        = module.database.security_group_id
}

resource "aws_security_group_rule" "db_from_hermes" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.hermes.id
  security_group_id        = module.database.security_group_id
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
    ENC_PROVIDER = "aws-kms"
    KMS_KEY_ID   = module.kms.key_arn
  }
  secret_arns = {
    HERMES_AGENT_API_KEY = module.secrets.secret_arns["hermes-agent-api-key"]
    OPENROUTER_API_KEY   = module.secrets.secret_arns["openrouter-api-key"]
    DATABASE_URL         = module.secrets.secret_arns["database-url"]
  }
  tags = local.tags
}

# ────────────────── Optional VPC endpoints ──────────────────
#
# Activating `use_vpc_endpoints = true` adds PrivateLink to KMS, Secrets
# Manager, CloudWatch Logs, and ECR. With these, the task subnets can omit
# NAT entirely for AWS API traffic — useful when egress is sensitive.
# LLM calls still need NAT (or a proxy / Bedrock) — out of scope of this
# module, see DEPLOYMENT.md.

locals {
  endpoints = var.use_vpc_endpoints ? toset([
    "kms",
    "secretsmanager",
    "logs",
    "ecr.api",
    "ecr.dkr",
  ]) : []
}

resource "aws_security_group" "endpoints" {
  count       = var.use_vpc_endpoints ? 1 : 0
  name        = "${var.name_prefix}-vpce-sg"
  description = "Interface endpoint ingress from VPC"
  vpc_id      = module.network.vpc_id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [module.network.vpc_cidr_block]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = local.tags
}

resource "aws_vpc_endpoint" "interface" {
  for_each            = local.endpoints
  vpc_id              = module.network.vpc_id
  service_name        = "com.amazonaws.${var.region}.${each.key}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = module.network.private_subnet_ids
  security_group_ids  = [aws_security_group.endpoints[0].id]
  private_dns_enabled = true
  tags                = merge(local.tags, { Name = "${var.name_prefix}-vpce-${each.key}" })
}

# ECR also needs an S3 gateway endpoint for layer downloads. Gateway
# endpoints attach to route tables, not subnets, so we wire them to the
# private route tables exposed by the network module.
resource "aws_vpc_endpoint" "s3" {
  count             = var.use_vpc_endpoints ? 1 : 0
  vpc_id            = module.network.vpc_id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = module.network.private_route_table_ids
  tags              = merge(local.tags, { Name = "${var.name_prefix}-vpce-s3" })
}
