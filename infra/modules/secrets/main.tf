# Secrets Manager entries the application reads at runtime.
#
# Each secret is created with an *empty* placeholder value so Terraform owns
# the lifecycle of the secret resource but NOT the contents. Real values are
# written by a separate, audited workflow (CI, the deploy role, or an
# operator's CLI). Keeping plaintext out of Terraform state is the rule.
#
# Rotation: enabled where AWS supports it natively (RDS master credentials);
# documented as a manual process for everything else (Google / QuickBooks
# OAuth client secrets, LLM provider API keys). See OPERATIONS.md §6.

terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.50" }
  }
}

variable "name_prefix" { type = string }
variable "environment" { type = string }
variable "kms_key_arn" { type = string }
variable "tags"        { type = map(string) default = {} }

locals {
  tags    = merge(var.tags, { Module = "secrets" })
  secrets = toset([
    "database-url",
    "app-enc-key",          # ignored when ENC_PROVIDER=aws-kms; kept for parity with dev
    "hermes-agent-api-key",
    "openrouter-api-key",
    "google-client-id",
    "google-client-secret",
    "quickbooks-client-id",
    "quickbooks-client-secret",
  ])
}

resource "aws_secretsmanager_secret" "this" {
  for_each   = local.secrets
  name       = "${var.name_prefix}/${var.environment}/${each.key}"
  kms_key_id = var.kms_key_arn
  # 7-day soft delete makes accidental destruction recoverable.
  recovery_window_in_days = 7
  tags                    = merge(local.tags, { Name = "${var.name_prefix}-${each.key}" })
}

# Outputs the ARNs so the ECS task role can `secretsmanager:GetSecretValue`
# them with a precise resource scope rather than a wildcard.
output "secret_arns" {
  value = { for k, s in aws_secretsmanager_secret.this : k => s.arn }
}
