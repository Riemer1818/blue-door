# The instance's public endpoint lives in the computed `load_balancer` block.
# (The older top-level endpoint_ip/endpoint_port attributes are deprecated.)
locals {
  endpoint      = one(scaleway_rdb_instance.main.load_balancer)
  endpoint_host = coalesce(local.endpoint.hostname, local.endpoint.ip)
}

output "endpoint_host" {
  value       = local.endpoint_host
  description = "Hostname (or IP) of the managed instance's public endpoint."
}

output "endpoint_port" {
  value = local.endpoint.port
}

output "database_name" {
  value = scaleway_rdb_database.main.name
}

output "admin_user" {
  value       = scaleway_rdb_instance.main.user_name
  description = "Admin role. Owns the schema, runs migrations, never used at runtime."
}

output "app_user" {
  value       = scaleway_rdb_user.app.name
  description = "Runtime role the web app connects as. Subject to row-level security."
}

# Scaleway's CA certificate for this instance. Write it to a file and switch the
# connection strings to sslmode=verify-full to get authentication of the server,
# not just encryption.
output "certificate" {
  value       = scaleway_rdb_instance.main.certificate
  sensitive   = true
  description = "Server CA certificate, for sslmode=verify-full."
}

# Read with `terraform output -raw admin_database_url`.
output "admin_database_url" {
  sensitive   = true
  description = "Connection string for migrations. Feed to db/apply.sh."
  value = format(
    "postgres://%s:%s@%s:%d/%s?sslmode=require",
    scaleway_rdb_instance.main.user_name,
    random_password.admin.result,
    local.endpoint_host,
    local.endpoint.port,
    scaleway_rdb_database.main.name,
  )
}

output "app_database_url" {
  sensitive   = true
  description = "Connection string for the web app. Goes in web/.env.local as DATABASE_URL."
  value = format(
    "postgres://%s:%s@%s:%d/%s?sslmode=require",
    scaleway_rdb_user.app.name,
    random_password.app.result,
    local.endpoint_host,
    local.endpoint.port,
    scaleway_rdb_database.main.name,
  )
}
