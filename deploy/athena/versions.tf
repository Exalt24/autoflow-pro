terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.region

  # offline_plan is for CI and local checks: it lets `terraform plan` run with dummy credentials and no network.
  # Left false, nothing here is skipped and every call goes to real AWS.
  skip_credentials_validation = var.offline_plan ? true : null
  skip_requesting_account_id  = var.offline_plan ? true : null
  skip_metadata_api_check     = var.offline_plan ? true : null

  default_tags {
    tags = {
      Project   = "autoflow-pro"
      ManagedBy = "terraform"
    }
  }
}
