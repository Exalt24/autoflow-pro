variable "region" {
  description = "AWS region for the cluster."
  type        = string
  default     = "ap-southeast-2"
}

variable "cluster_name" {
  description = "Name of the EKS cluster. Also the prefix for the VPC, roles and node group."
  type        = string
  default     = "autoflow-pro"
}

variable "kubernetes_version" {
  description = "EKS control plane version."
  type        = string
  default     = "1.34"
}

variable "azs" {
  description = "Availability zones to spread over. Two or more. Listed here so a plan needs no AWS lookup."
  type        = list(string)
  default     = ["ap-southeast-2a", "ap-southeast-2b"]

  validation {
    condition     = length(var.azs) >= 2
    error_message = "EKS needs subnets in at least two availability zones."
  }
}

variable "vpc_cidr" {
  description = "CIDR block of the VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "single_nat_gateway" {
  description = "One NAT gateway for all private subnets (cheaper) instead of one per zone (survives a zone outage)."
  type        = bool
  default     = true
}

variable "node_group_suffix" {
  description = "Suffix of the managed node group name. Changing it creates a new node group beside a slow deleting one, since AWS keeps a name reserved until its deletion finishes."
  type        = string
  default     = "default"
}

variable "node_instance_types" {
  description = "Instance types for the managed node group. m7i-flex.large (2 vCPU, 8 GiB) is on AWS's free tier list, which an account on the free plan is limited to; a t3.large node group could not launch there."
  type        = list(string)
  default     = ["m7i-flex.large"]
}

variable "node_min_size" {
  description = "Smallest node count the managed node group scales down to."
  type        = number
  default     = 2
}

variable "node_desired_size" {
  description = "Starting node count. Terraform ignores later changes so the autoscaler can own it."
  type        = number
  default     = 2
}

variable "node_max_size" {
  description = "Largest node count the managed node group scales up to."
  type        = number
  default     = 4
}

variable "public_access_cidrs" {
  description = "Who may reach the public Kubernetes API endpoint. Narrow this to your office or VPN range before an apply."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "k8s_namespace" {
  description = "Namespace the Helm release is installed into. The IRSA trust policy is limited to it."
  type        = string
  default     = "autoflow"
}

variable "k8s_service_account" {
  description = "Service account the worker pods run as. Must match serviceAccount.name in the Helm chart."
  type        = string
  default     = "autoflow"
}

variable "archive_bucket_name" {
  description = "S3 bucket from deploy/aws that the worker archives finished runs into."
  type        = string
  default     = "autoflow-archive-000000000000"
}

variable "archive_prefix" {
  description = "Key prefix the worker may read and write in the archive bucket. Same value as deploy/aws."
  type        = string
  default     = "executions/"
}

variable "offline_plan" {
  description = "Skip the credential, account id and metadata checks so plan runs with dummy credentials and no network."
  type        = bool
  default     = false
}
