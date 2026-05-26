terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.50" }
  }

  # See ../public-internet/versions.tf for the S3 backend pattern. The same
  # comment applies here — the only difference is the state file key.
  # backend "s3" {
  #   bucket         = "kindcaddy-tf-state"
  #   key            = "private-vpc/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "kindcaddy-tf-locks"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project     = "kindcaddy"
      Environment = var.environment
      ManagedBy   = "terraform"
      Variant     = "private-vpc"
    }
  }
}
