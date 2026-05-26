variable "region"      { type = string  default = "us-east-1" }
variable "name_prefix" { type = string  default = "kindcaddy" }
variable "environment" { type = string  default = "staging" }

variable "azs" {
  type    = list(string)
  default = ["us-east-1a", "us-east-1b"]
}

variable "vpc_cidr_block" {
  type    = string
  default = "10.42.0.0/16"
}

variable "trusted_cidr_blocks" {
  description = "CIDRs allowed to reach the internal ALB. Usually your corporate VPN / Direct Connect / TGW-attached VPC ranges."
  type        = list(string)
}

variable "hermes_image" {
  description = "Container image URI for the Hermes agent service."
  type        = string
}

variable "app_image" {
  description = "Container image URI for the Next.js application service."
  type        = string
}

variable "app_desired_count"    { type = number  default = 2 }
variable "hermes_desired_count" { type = number  default = 2 }

variable "use_vpc_endpoints" {
  description = "If true, create PrivateLink endpoints for KMS / Secrets Manager / Logs / ECR so the app can run with no NAT gateway. Adds ~$30/mo/endpoint."
  type        = bool
  default     = false
}

variable "internal_acm_certificate_arn" {
  description = "ACM certificate for the internal ALB (e.g. *.internal.kindcaddy.example.com). Required for HTTPS."
  type        = string
  default     = ""
}
