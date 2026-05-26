terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.50" }
  }

  # Recommended remote state — uncomment after creating the S3 bucket +
  # DynamoDB lock table. State contains DB passwords (sensitive marked but
  # still persisted), so the bucket MUST be encrypted and access-restricted.
  #
  # backend "s3" {
  #   bucket         = "kindcaddy-tf-state"
  #   key            = "public-internet/terraform.tfstate"
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
      Variant     = "public-internet"
    }
  }
}
