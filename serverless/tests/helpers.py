def order_body(order_id="o1", customer_id="c1", lines=None):
    lines = lines if lines is not None else [{"sku": "widget", "qty": 2, "price_cents": 500}]
    return {"order_id": order_id, "customer_id": customer_id, "lines": lines}
