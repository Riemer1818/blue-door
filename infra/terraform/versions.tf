# Scaleway Managed Database for PostgreSQL, fr-par (EU).
#
# NOTE: the Scaleway provider evolves. Before trusting this, run
#   terraform init && terraform plan
# to validate resource/attribute names against the pinned version, and
#   scw rdb engine list
# to confirm the engine version string is still offered.

terraform {
  required_version = ">= 1.6"

  required_providers {
    scaleway = {
      source  = "scaleway/scaleway"
      version = "~> 2.50"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Recommended: keep state in Scaleway Object Storage rather than on a laptop.
  # Fill in and `terraform init -migrate-state` once the bucket exists.
  # backend "s3" {
  #   bucket                      = "bluedoor-tfstate"
  #   key                         = "db/terraform.tfstate"
  #   region                      = "fr-par"
  #   endpoints                   = { s3 = "https://s3.fr-par.scw.cloud" }
  #   skip_credentials_validation = true
  #   skip_region_validation      = true
  #   skip_requesting_account_id  = true
  # }
}
