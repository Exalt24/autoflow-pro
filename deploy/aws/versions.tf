terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

locals {
  emulator = var.emulator_endpoint != ""
}

provider "aws" {
  region = var.region

  # The settings below apply only when emulator_endpoint is set (for example http://localhost:5000
  # for moto). Left empty there is no endpoints block and no skip flag: every call goes to real AWS.
  s3_use_path_style           = local.emulator ? true : null
  skip_credentials_validation = local.emulator ? true : null
  skip_requesting_account_id  = local.emulator ? true : null
  skip_metadata_api_check     = local.emulator ? true : null

  dynamic "endpoints" {
    for_each = local.emulator ? [var.emulator_endpoint] : []
    content {
      s3  = endpoints.value
      iam = endpoints.value
      sts = endpoints.value
    }
  }
}
