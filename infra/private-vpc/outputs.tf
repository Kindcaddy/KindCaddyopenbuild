output "internal_alb_dns_name" {
  value       = aws_lb.internal.dns_name
  description = "Internal ALB DNS — reachable only from the VPC and peered networks."
}

output "vpc_id"             { value = module.network.vpc_id }
output "private_subnet_ids" { value = module.network.private_subnet_ids }
output "ecs_cluster_arn"    { value = aws_ecs_cluster.this.arn }
output "app_service_name"    { value = module.app.service_name }
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
    1. Add a Route 53 *private* hosted zone (or update your corporate DNS) so
       internal clients can resolve a friendly name to:
         ${aws_lb.internal.dns_name}

    2. Populate Secrets Manager values; especially `database-url`, the
       OAuth client secrets, and `openrouter-api-key`.

    3. Build + push app and Hermes images to ECR; update var.app_image and
       var.hermes_image.

    4. Confirm intranet reachability:
         curl -k https://<your-internal-dns>/api/me
       (Expects 401 from the auth guard — that proves the app is reachable
       and the guard is wired correctly.)

    5. If `use_vpc_endpoints = true`, verify NAT egress can be removed:
         aws ec2 describe-nat-gateways  # should still exist for LLM egress
       and your platform team can swap in a Bedrock or proxy path if even
       LLM traffic must stay inside AWS.
  EOT
}
