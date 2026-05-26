output "alb_dns_name" {
  value       = aws_lb.public.dns_name
  description = "Public ALB DNS — point your Route 53 record at this."
}

output "vpc_id"            { value = module.network.vpc_id }
output "private_subnet_ids" { value = module.network.private_subnet_ids }
output "ecs_cluster_arn"   { value = aws_ecs_cluster.this.arn }
output "hermes_service_name" { value = module.hermes.service_name }

output "rds_endpoint" {
  value     = module.database.endpoint
  sensitive = true
}

output "kms_key_arn"   { value = module.kms.key_arn }
output "kms_key_alias" { value = module.kms.key_alias }

output "secret_arns" {
  value     = module.secrets.secret_arns
  sensitive = true
}

output "next_steps" {
  value = <<-EOT
    1. Populate the Secrets Manager values:
         aws secretsmanager put-secret-value --secret-id ${var.name_prefix}/${var.environment}/database-url --secret-string '...'
       (Use a managed rotation policy for database-url against the RDS module above.)

    2. Build + push the Hermes image to ECR; update var.hermes_image.

    3. Point Vercel's HERMES_AGENT_BASE_URL at:
         https://${aws_lb.public.dns_name}/v1

    4. (Production only) Set var.vercel_jwt_issuer to the Vercel OIDC issuer
       and var.alb_allowed_cidrs to Vercel's egress ranges to lock the ALB
       to Vercel-originated traffic only.
  EOT
}
