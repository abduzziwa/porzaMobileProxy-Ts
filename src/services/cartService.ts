import pgClient from "./db.js";
import type { CartItem } from "../types.js";

// ── Add or Increment ──────────────────────────────────────────
export const addOrIncrementProduct = async (
  cartId: string,
  productId: string,
): Promise<CartItem> => {
  const { rows } = await pgClient.query<CartItem>(
    `
    INSERT INTO cart_items (cart_id, product_id, quantity)
    VALUES ($1, $2, 1)
    ON CONFLICT (cart_id, product_id)
    DO UPDATE SET
      quantity = cart_items.quantity + 1,
      deleted = FALSE,
      deleted_at = NULL
    RETURNING *
  `,
    [cartId, productId],
  );

  return rows[0];
};

export const decrementProduct = async (
  cartId: string,
  productId: string,
): Promise<CartItem | undefined> => {
  await pgClient.query(
    `
    UPDATE cart_items
    SET quantity = quantity - 1
    WHERE cart_id = $1 AND product_id = $2 AND quantity > 0
  `,
    [cartId, productId],
  );

  const { rows } = await pgClient.query<CartItem>(
    `
    UPDATE cart_items
    SET deleted = TRUE, deleted_at = NOW(), quantity = 0
    WHERE cart_id = $1 AND product_id = $2 AND quantity <= 0
    RETURNING *
  `,
    [cartId, productId],
  );

  return rows[0];
};

export const deleteProduct = async (
  cartId: string,
  productId: string,
): Promise<CartItem | undefined> => {
  const { rows } = await pgClient.query<CartItem>(
    `
    UPDATE cart_items
    SET deleted = TRUE, deleted_at = NOW(), quantity = 0
    WHERE cart_id = $1 AND product_id = $2
    RETURNING *
  `,
    [cartId, productId],
  );

  return rows[0];
};

export const updateProductQuantity = async (
  cartId: string,
  productId: string,
  quantity: number,
): Promise<CartItem | undefined> => {
  if (quantity <= 0) return deleteProduct(cartId, productId);

  const { rows } = await pgClient.query<CartItem>(
    `
    UPDATE cart_items
    SET quantity = $3
    WHERE cart_id = $1 AND product_id = $2
    RETURNING *
  `,
    [cartId, productId, quantity],
  );

  return rows[0];
};

export const getActiveCart = async (cartId: string): Promise<CartItem[]> => {
  const { rows } = await pgClient.query<CartItem>(
    `
    SELECT product_id, quantity
    FROM cart_items
    WHERE cart_id = $1 AND deleted = FALSE AND processed = FALSE
  `,
    [cartId],
  );

  return rows;
};

export const markCartProcessed = async (
  cartId: string,
): Promise<CartItem[]> => {
  const { rows } = await pgClient.query<CartItem>(
    `
    UPDATE cart_items SET processed = TRUE
    WHERE cart_id = $1 AND deleted = FALSE
    RETURNING *
  `,
    [cartId],
  );

  return rows;
};

export const getDeletedItems = async (cartId: string): Promise<CartItem[]> => {
  const { rows } = await pgClient.query<CartItem>(
    `
    SELECT product_id, quantity, deleted_at
    FROM cart_items
    WHERE cart_id = $1 AND deleted = TRUE
  `,
    [cartId],
  );

  return rows;
};
