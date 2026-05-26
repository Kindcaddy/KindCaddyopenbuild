# IAM roles used by ECS tasks.
#
#   execution_role: pulled by ECS to start the container — fetches the image
#                   from ECR, writes logs to CloudWatch, reads secrets from
#                   Secrets Manager. NOT used by the app at runtime.
#
#   task_role:      the application's *runtime* identity. This is what the
#                   app sends as its caller when it calls AWS APIs (KMS
#                   Decrypt for envelope unwrap, etc). Keeping it separate
#                   from the execution role is the principle-of-least-priv
#                   default: a compromised app can't fetch new secrets, only
#                   use what was already injected at start.

terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.50" }
  }
}

variable "name_prefix"   { type = string }
variable "environment"   { type = string }
variable "kms_key_arn"   { type = string }
variable "secret_arns"   { type = map(string) }
variable "tags"          { type = map(string) default = {} }

locals { tags = merge(var.tags, { Module = "iam-roles" }) }

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# ---------- Execution role ----------

resource "aws_iam_role" "execution" {
  name               = "${var.name_prefix}-${var.environment}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = values(var.secret_arns)
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = [var.kms_key_arn]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# ---------- Task (runtime) role ----------

resource "aws_iam_role" "task" {
  name               = "${var.name_prefix}-${var.environment}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = local.tags
}

data "aws_iam_policy_document" "task_runtime" {
  # The application uses KMS for envelope encryption of OAuth tokens at rest.
  # Encrypt + Decrypt are both required because the app generates a fresh DEK
  # per row and re-wraps on token rotation. No key administration.
  statement {
    actions   = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"]
    resources = [var.kms_key_arn]
  }
}

resource "aws_iam_role_policy" "task_runtime" {
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task_runtime.json
}

output "execution_role_arn" { value = aws_iam_role.execution.arn }
output "task_role_arn"      { value = aws_iam_role.task.arn }
