variable "region" {
  description = "AWS region for the buckets, the Glue catalog and the Athena workgroup."
  type        = string
  default     = "ap-southeast-2"
}

variable "name_prefix" {
  description = "Resource names start with this. Glue names cannot hold a dash, so the database is <prefix>_events, the workgroup <prefix>-events and the buckets <prefix>-lake-<suffix> and <prefix>-athena-results-<suffix>."
  type        = string
  default     = "autoflow"

  validation {
    condition     = can(regex("^[a-z][a-z0-9]{0,30}$", var.name_prefix))
    error_message = "name_prefix must be lowercase letters and digits, starting with a letter, because Glue names are lowercase without dashes."
  }
}

variable "account_id" {
  description = "The AWS account id, used in ARNs and as the default bucket suffix. Null looks it up from the credentials. Set it for an offline plan."
  type        = string
  default     = null
}

variable "bucket_suffix" {
  description = "Suffix that makes the bucket names globally unique. Null uses the AWS account id."
  type        = string
  default     = null
}

variable "events_prefix" {
  description = "Prefix the backend writes run events under (backend/src/athena/eventLake.ts EVENTS_PREFIX). The table location, the IAM policy and the lifecycle rule are limited to it."
  type        = string
  default     = "events/"
}

variable "projection_start_day" {
  description = "First day the dt partition projection covers. The range runs from here to today."
  type        = string
  default     = "2026-01-01"

  validation {
    condition     = can(regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}$", var.projection_start_day))
    error_message = "projection_start_day must look like 2026-01-01."
  }
}

variable "events_expiry_days" {
  description = "Days after which event files are expired."
  type        = number
  default     = 365
}

variable "results_expiry_days" {
  description = "Days after which Athena query result files are expired."
  type        = number
  default     = 7
}

variable "bytes_scanned_cutoff" {
  description = "The most data one query in the workgroup may scan, in bytes. The service minimum is 10485760."
  type        = number
  default     = 10737418240

  validation {
    condition     = var.bytes_scanned_cutoff >= 10485760
    error_message = "Athena needs a cutoff of at least 10485760 bytes."
  }
}

variable "force_destroy" {
  description = "Let terraform destroy delete the buckets even if they hold files, and the workgroup even if it holds named queries."
  type        = bool
  default     = false
}

variable "offline_plan" {
  description = "Plan with dummy credentials and no AWS call. For CI and local checks only."
  type        = bool
  default     = false
}
