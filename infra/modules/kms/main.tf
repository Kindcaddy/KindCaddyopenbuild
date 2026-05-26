# Customer-managed KMS key used for:
#   - Envelope encryption of Resource.data (see lib/crypto.ts)
#   - RDS at-rest encryption (passed to the database module)
#   - Secrets Manager encryption (passed to the secrets module)
#
# A single key per environment is the simplest model that still gives us
# per-environment blast radius. Annual key rotation is on by default.
#
# The key policy intentionally keeps key administration with the AWS account
# root (so account admins can recover from a misconfigured role), while
# day-to-day encrypt/decrypt is delegated to whatever roles the variant
# passes in via var.key_user_role_arns.

terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.50" }
  }
}

variable "name_prefix"          { type = string }
variable "environment"          { type = string }
variable "key_user_role_arns"   {
  type        = list(string)
  description = "IAM role ARNs that will Encrypt/Decrypt with this key (ECS task role, etc.)"
  default     = []
}
variable "tags" { type = map(string) default = {} }

data "aws_caller_identity" "current" {}

locals {
  tags = merge(var.tags, { Module = "kms" })

  key_policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [
        {
          Sid    = "EnableRootAccountAdministration"
          Effect = "Allow"
          Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }
          Action   = "kms:*"
          Resource = "*"
        }
      ],
      length(var.key_user_role_arns) > 0 ? [
        {
          Sid    = "AllowApplicationUseOfTheKey"
          Effect = "Allow"
          Principal = { AWS = var.key_user_role_arns }
          Action = [
            "kms:Encrypt",
            "kms:Decrypt",
            "kms:ReEncrypt*",
            "kms:GenerateDataKey*",
            "kms:DescribeKey",
          ]
          Resource = "*"
        }
      ] : []
    )
  })
}

resource "aws_kms_key" "this" {
  description             = "${var.name_prefix} ${var.environment} — envelope encryption + at-rest"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = local.key_policy
  tags                    = merge(local.tags, { Name = "${var.name_prefix}-cmk" })
}

resource "aws_kms_alias" "this" {
  name          = "alias/${var.name_prefix}-${var.environment}-resource-data"
  target_key_id = aws_kms_key.this.key_id
}

output "key_arn"   { value = aws_kms_key.this.arn }
output "key_id"    { value = aws_kms_key.this.key_id }
output "key_alias" { value = aws_kms_alias.this.name }
