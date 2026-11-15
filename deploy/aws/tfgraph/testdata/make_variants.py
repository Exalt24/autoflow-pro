# LIFESPAN: permanent
# Writes the hand broken plans in testdata/variants/ from the real create plan in testdata/real/. Each variant is the
# real plan.json with one deliberate edit, so the rule under test is the only thing that changed.
import copy
import json
import pathlib

here = pathlib.Path(__file__).parent
base = json.loads((here / "real" / "plan-create-offline.json").read_text())
out = here / "variants"
out.mkdir(exist_ok=True)


def change(plan, rtype):
    return next(c for c in plan["resource_changes"] if c["type"] == rtype)


def policy_of(plan):
    c = change(plan, "aws_iam_policy")
    return c, json.loads(c["change"]["after"]["policy"])


def set_policy(c, doc):
    c["change"]["after"]["policy"] = json.dumps(doc, separators=(",", ":"))


def drop(plan, rtype):
    plan["resource_changes"] = [c for c in plan["resource_changes"] if c["type"] != rtype]
    root = plan["planned_values"]["root_module"]
    root["resources"] = [r for r in root["resources"] if r["type"] != rtype]
    cfg = plan["configuration"]["root_module"]
    cfg["resources"] = [r for r in cfg["resources"] if r["type"] != rtype]


def save(name, plan):
    (out / f"{name}.json").write_bytes((json.dumps(plan, indent=2) + "\n").encode())
    print("wrote variants/" + name + ".json")


def v():
    return copy.deepcopy(base)


p = v()
c, doc = policy_of(p)
doc["Statement"][0]["Action"] = ["s3:PutObject", "s3:*"]
set_policy(c, doc)
save("wildcard-action", p)

p = v()
c, doc = policy_of(p)
doc["Statement"][0]["Resource"] = "*"
set_policy(c, doc)
save("wildcard-resource", p)

p = v()
c, doc = policy_of(p)
bucket = doc["Statement"][1]["Resource"]
doc["Statement"][0]["Resource"] = bucket + "/*"
del doc["Statement"][1]["Condition"]
set_policy(c, doc)
save("wide-resource", p)

p = v()
drop(p, "aws_s3_bucket_public_access_block")
save("missing-public-access-block", p)

p = v()
change(p, "aws_s3_bucket_public_access_block")["change"]["after"]["block_public_policy"] = False
save("public-access-block-off", p)

p = v()
drop(p, "aws_s3_bucket_server_side_encryption_configuration")
change(p, "aws_s3_bucket_versioning")["change"]["after"]["versioning_configuration"][0]["status"] = "Suspended"
save("no-encryption-versioning-suspended", p)

p = v()
c = change(p, "aws_s3_bucket_public_access_block")
c["change"]["actions"] = ["delete"]
c["change"]["before"] = c["change"]["after"]
c["change"]["after"] = None
c["change"]["after_unknown"] = {}
c = change(p, "aws_s3_bucket")
c["change"]["actions"] = ["delete", "create"]
c["change"]["before"] = copy.deepcopy(c["change"]["after"])
c["action_reason"] = "replace_because_cannot_update"
save("delete-and-replace-planned", p)

p = v()
c, _ = policy_of(p)
del c["change"]["after"]["policy"]
c["change"]["after_unknown"]["policy"] = True
change(p, "aws_s3_bucket_versioning")["change"]["after_unknown"]["versioning_configuration"] = [{"status": True}]
change(p, "aws_s3_bucket_public_access_block")["change"]["after_unknown"]["block_public_policy"] = True
save("unknown-values", p)

p = v()
c, _ = policy_of(p)
c["change"]["after"]["policy"] = "{not json"
save("policy-not-json", p)

# The finding run in docs/test-runs: the policy widened the way a hurried edit would do it
p = v()
c, doc = policy_of(p)
doc["Statement"][0]["Action"] = ["s3:*"]
doc["Statement"][0]["Resource"] = bucket + "/*"
del doc["Statement"][1]["Condition"]
set_policy(c, doc)
save("widened-policy", p)
