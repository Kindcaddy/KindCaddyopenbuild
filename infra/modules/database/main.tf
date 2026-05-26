# RDS Postgres 16, optionally Multi-AZ.
#
# Decision points encoded here:
#   - Encryption at rest with a customer-managed KMS key (not the AWS-managed
#     default). Required for most enterprise reviews; trivial to enable.
#   - Performance Insights ON, 7-day retention. Cheap, indispensable for the
#     runbooks in OPERATIONS.md §5.4.
#   - Automated backups: 7 days; Multi-AZ in prod for synchronous standby.
#   - Public access: FALSE. Always reachable via private subnets only.
#   - Auto minor version upgrade: ON. The maintenance window controls when.

terraform {
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.50" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

variable "name_prefix"        { type = string }
variable "environment"        { type = string }
variable "vpc_id"             { type = string }
variable "subnet_ids"         { type = list(string) }
variable "ingress_cidr_blocks" {
  type        = list(string)
  description = "VPC CIDRs allowed to reach 5432. Usually just the VPC CIDR."
}
variable "instance_class"     { type = string  default = "db.t4g.small" }
variable "multi_az"           { type = bool    default = false }
variable "allocated_storage"  { type = number  default = 20 }
variable "kms_key_arn"        { type = string }
variable "tags"               { type = map(string) default = {} }

locals { tags = merge(var.tags, { Module = "database" }) }

resource "random_password" "master" {
  length  = 32
  special = false # avoid quoting headaches in DSNs; 32 chars at 62-char alphabet is plenty
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.name_prefix}-db-subnets"
  subnet_ids = var.subnet_ids
  tags       = local.tags
}

resource "aws_security_group" "db" {
  name        = "${var.name_prefix}-db-sg"
  description = "Postgres ingress from app subnets"
  vpc_id      = var.vpc_id
  tags        = local.tags
}

resource "aws_security_group_rule" "db_ingress" {
  type              = "ingress"
  from_port         = 5432
  to_port           = 5432
  protocol          = "tcp"
  security_group_id = aws_security_group.db.id
  cidr_blocks       = var.ingress_cidr_blocks
}

resource "aws_security_group_rule" "db_egress" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  security_group_id = aws_security_group.db.id
  cidr_blocks       = ["0.0.0.0/0"] # outbound is unconstrained; RDS doesn't initiate connections
}

resource "aws_db_instance" "this" {
  identifier              = "${var.name_prefix}-db"
  engine                  = "postgres"
  engine_version          = "16"
  instance_class          = var.instance_class
  allocated_storage       = var.allocated_storage
  max_allocated_storage   = var.allocated_storage * 5 # storage autoscaling cap
  db_name                 = "kindcaddy"
  username                = "kindcaddy"
  password                = random_password.master.result
  publicly_accessible     = false
  multi_az                = var.multi_az
  storage_encrypted       = true
  kms_key_id              = var.kms_key_arn
  db_subnet_group_name    = aws_db_subnet_group.this.name
  vpc_security_group_ids  = [aws_security_group.db.id]
  backup_retention_period = 7
  delete_automated_backups = false
  deletion_protection     = var.environment == "prod"
  skip_final_snapshot     = var.environment != "prod"
  final_snapshot_identifier = var.environment == "prod" ? "${var.name_prefix}-db-final-${formatdate("YYYYMMDDhhmmss", timestamp())}" : null
  performance_insights_enabled          = true
  performance_insights_retention_period = 7
  performance_insights_kms_key_id       = var.kms_key_arn
  auto_minor_version_upgrade            = true
  maintenance_window                    = "sun:08:00-sun:09:00" # UTC
  backup_window                         = "07:00-07:30"

  tags = merge(local.tags, { Name = "${var.name_prefix}-db" })

  lifecycle {
    # The final_snapshot_identifier embeds a timestamp; we don't want
    # Terraform to recreate the DB just because the timestamp changed.
    ignore_changes = [final_snapshot_identifier]
  }
}

output "endpoint" { value = aws_db_instance.this.endpoint }
output "port"     { value = aws_db_instance.this.port }
output "db_name"  { value = aws_db_instance.this.db_name }
output "security_group_id" { value = aws_security_group.db.id }
output "master_username" {
  value     = aws_db_instance.this.username
  sensitive = true
}
output "master_password" {
  value     = random_password.master.result
  sensitive = true
}
