output "cluster_name" {
  description = "EKS cluster name."
  value       = aws_eks_cluster.this.name
}

output "cluster_endpoint" {
  description = "Kubernetes API endpoint."
  value       = aws_eks_cluster.this.endpoint
}

output "oidc_issuer" {
  description = "OIDC issuer URL registered as the IAM identity provider."
  value       = aws_eks_cluster.this.identity[0].oidc[0].issuer
}

output "worker_role_arn" {
  description = "IAM role for the worker. Put it in the Helm values as serviceAccount.annotations.\"eks.amazonaws.com/role-arn\"."
  value       = aws_iam_role.worker.arn
}

output "ecr_repository_url" {
  description = "Where to push the backend image."
  value       = aws_ecr_repository.backend.repository_url
}

output "kubeconfig_command" {
  description = "Run this to point kubectl at the cluster."
  value       = "aws eks update-kubeconfig --region ${var.region} --name ${aws_eks_cluster.this.name}"
}

output "worker_service_account_subject" {
  description = "The service account the worker role trusts. The Helm chart's namespace and serviceAccount.name must produce exactly this."
  value       = "system:serviceaccount:${var.k8s_namespace}:${var.k8s_service_account}"
}
