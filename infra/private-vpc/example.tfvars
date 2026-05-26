region       = "us-east-1"
name_prefix  = "kindcaddy"
environment  = "staging"
azs          = ["us-east-1a", "us-east-1b"]
vpc_cidr_block = "10.42.0.0/16"

# REQUIRED: the CIDRs your users will reach the internal ALB from. Examples:
#   - Corporate VPN egress range:   10.0.0.0/8
#   - Direct Connect attached range: 192.168.0.0/16
#   - Peered VPC range:              172.31.0.0/16
trusted_cidr_blocks = ["10.0.0.0/8"]

app_image    = "<ACCOUNT-ID>.dkr.ecr.us-east-1.amazonaws.com/kindcaddy-app:latest"
hermes_image = "<ACCOUNT-ID>.dkr.ecr.us-east-1.amazonaws.com/kindcaddy-hermes:latest"

# Staging keeps task counts low.
app_desired_count    = 1
hermes_desired_count = 1

# Set to true to drop NAT egress for AWS API traffic (~$100/mo savings if
# you remove NAT entirely; ~$30/mo cost for the endpoints themselves).
use_vpc_endpoints = false

# Required for HTTPS on the internal ALB.
# internal_acm_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/..."
