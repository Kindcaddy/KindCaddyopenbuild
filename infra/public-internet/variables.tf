variable "region" {
  description = "AWS region."
  type        = string
  default     = "us-east-1"
}

variable "name_prefix" {
  description = "Prefix applied to every resource name. Lets one AWS account host multiple installs."
  type        = string
  default     = "kindcaddy"
}

variable "environment" {
  description = "staging | prod. Controls Multi-AZ, deletion protection, instance sizing."
  type        = string
  default     = "staging"
}

variable "azs" {
  description = "Two AZs in the chosen region."
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "vpc_cidr_block" {
  description = "CIDR for the VPC. Must not overlap any peered networks."
  type        = string
  default     = "10.40.0.0/16"
}

variable "hermes_image" {
  description = "Container image URI for the Hermes agent service. Pushed by CI."
  type        = string
}

variable "hermes_desired_count" {
  description = "Number of Hermes Fargate tasks."
  type        = number
  default     = 2
}

variable "vercel_jwt_issuer" {
  description = "Issuer claim that Vercel's signed requests will carry. Used by the ALB to authenticate Vercel-originated traffic. Leave blank to disable (open ALB)."
  type        = string
  default     = ""
}

variable "alb_allowed_cidrs" {
  description = "CIDRs allowed to reach the public ALB. Default ['0.0.0.0/0'] is open internet; restrict in prod."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "acm_certificate_arn" {
  description = "ACM certificate for the public ALB. Must be in the same region as the ALB. Leave blank to skip HTTPS listener (HTTP-only, dev only)."
  type        = string
  default     = ""
}
