# Settings for running against a local moto server: terraform apply -var-file=emulator.tfvars
# The last two are for the emulator only. Their defaults (false) are what a real account gets.
emulator_endpoint = "http://localhost:5000"
create_access_key = true
force_destroy     = true
