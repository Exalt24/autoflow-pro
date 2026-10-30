variable "region" {
  description = "AWS region for the archive bucket."
  type        = string
  default     = "ap-southeast-2"
}

variable "name_prefix" {
  description = "Every resource name starts with this: the bucket is <prefix>-<suffix>, the IAM user <prefix>-user, the policy <prefix>-policy."
  type        = string
  default     = "autoflow-archive"
}

variable "bucket_suffix" {
  description = "Suffix that makes the bucket name globally unique. Null uses the AWS account id."
  type        = string
  default     = null
}

variable "archive_prefix" {
  description = "Prefix the backend writes archives under. The IAM policy and the lifecycle rule are limited to it."
  type        = string
  default     = "executions/"
}

variable "archive_expiry_days" {
  description = "Days after which archived runs are expired."
  type        = number
  default     = 90
}

variable "noncurrent_expiry_days" {
  description = "Days after which replaced or deleted object versions are removed."
  type        = number
  default     = 30
}

variable "create_access_key" {
  description = "Create an access key for the IAM user. Leave false where the backend runs with an IAM role."
  type        = bool
  default     = false
}

variable "force_destroy" {
  description = "Let terraform destroy remove a bucket that still holds objects."
  type        = bool
  default     = false
}

variable "emulator_endpoint" {
  description = "Endpoint of a local AWS emulator such as moto. Empty means real AWS."
  type        = string
  default     = ""
}
