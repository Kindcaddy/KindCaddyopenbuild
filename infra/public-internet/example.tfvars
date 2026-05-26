region       = "us-east-1"
name_prefix  = "kindcaddy"
environment  = "staging"
azs          = ["us-east-1a", "us-east-1b"]
vpc_cidr_block = "10.40.0.0/16"

# Replace with your pushed Hermes image. Until then this is a placeholder
# that will fail `terraform apply` with a clear "image not found" — by design.
hermes_image = "<ACCOUNT-ID>.dkr.ecr.us-east-1.amazonaws.com/kindcaddy-hermes:latest"

# Staging keeps the ALB open + 1 Fargate task to halve cost.
hermes_desired_count = 1
alb_allowed_cidrs    = ["0.0.0.0/0"]

# Add when ready:
# acm_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/..."
# vercel_jwt_issuer   = "https://oidc.vercel.com/<team-slug>"
