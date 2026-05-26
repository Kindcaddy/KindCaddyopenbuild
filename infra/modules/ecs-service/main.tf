# A generic Fargate service module — used for Hermes in both variants, and
# for the Next.js app in the private-vpc variant.
#
# Inputs are intentionally minimal; the variant configures port, image, env,
# and target group. Logs go to CloudWatch under /ecs/<service-name>.
#
# IAM:
#   - Execution role: pulls the image, fetches secrets, writes logs.
#   - Task role: the app's runtime identity (kms:Decrypt, etc).
#
# Health check:
#   - The ALB target group passes a path check at the variant level.
#   - The ECS service uses a container health check on the same path.

terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.50" }
  }
}

variable "name_prefix"          { type = string }
variable "service_name"         { type = string }
variable "environment"          { type = string }
variable "cluster_arn"          { type = string }
variable "subnet_ids"           { type = list(string) }
variable "security_group_ids"   { type = list(string) }
variable "image"                { type = string }
variable "container_port"       { type = number }
variable "cpu"                  { type = number  default = 512 }
variable "memory"               { type = number  default = 1024 }
variable "desired_count"        { type = number  default = 1 }
variable "task_role_arn"        { type = string }
variable "execution_role_arn"   { type = string }
variable "environment_vars"     { type = map(string) default = {} }
variable "secret_arns"          {
  type        = map(string)
  description = "name → arn for environment vars sourced from Secrets Manager"
  default     = {}
}
variable "target_group_arn"     { type = string }
variable "tags"                 { type = map(string) default = {} }

locals { tags = merge(var.tags, { Service = var.service_name }) }

resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${var.name_prefix}-${var.service_name}"
  retention_in_days = 30
  tags              = local.tags
}

resource "aws_ecs_task_definition" "this" {
  family                   = "${var.name_prefix}-${var.service_name}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn

  container_definitions = jsonencode([
    {
      name      = var.service_name
      image     = var.image
      essential = true
      portMappings = [{
        containerPort = var.container_port
        protocol      = "tcp"
      }]
      environment = [
        for k, v in var.environment_vars : { name = k, value = v }
      ]
      secrets = [
        for k, arn in var.secret_arns : { name = k, valueFrom = arn }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.this.name
          awslogs-region        = data.aws_region.current.name
          awslogs-stream-prefix = var.service_name
        }
      }
    }
  ])

  tags = local.tags
}

data "aws_region" "current" {}

resource "aws_ecs_service" "this" {
  name            = "${var.name_prefix}-${var.service_name}"
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = var.security_group_ids
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.target_group_arn
    container_name   = var.service_name
    container_port   = var.container_port
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 60

  lifecycle {
    # Allow `aws ecs update-service --task-definition` to roll the service
    # forward without Terraform fighting the new revision back to the old.
    ignore_changes = [task_definition, desired_count]
  }

  tags = local.tags
}

output "service_name" { value = aws_ecs_service.this.name }
output "task_definition_family" { value = aws_ecs_task_definition.this.family }
output "log_group_name" { value = aws_cloudwatch_log_group.this.name }
