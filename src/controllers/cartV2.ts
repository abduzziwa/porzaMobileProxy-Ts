import type { Request, Response } from "express";
import { addOrIncrementProduct, decrementProduct, deleteProduct, updateProductQuantity, getActiveCart, markCartProcessed } from "../services/cartService.js";

export async function addProduct(req: Request, res: Response): Promise<Response> {
  try {
    const { uniqueDeviceId, cartId, productId } = req.body as Record<string, string>;
    if (!cartId || !productId) return res.status(400).json({ success: false, error: "Missing cartId or productId" });
    await addOrIncrementProduct(cartId, productId);
    const cartItems = await getActiveCart(cartId);
    const itemCount = cartItems.reduce((sum, i) => sum + i.quantity, 0);
    return res.status(200).json({ success: true, cartId, uniqueDeviceId, resource: {}, data: { status: "success", error: "", popupTitle: "", popupContent: "", itemCount: String(itemCount) } });
  } catch (err) {
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
}

export async function cartDeleteV2(req: Request, res: Response): Promise<Response> {
  try {
    const { uniqueDeviceId, cartId, itemId, action } = req.body as Record<string, string>;
    if (!cartId || !action) return res.status(400).json({ success: false, error: "Missing cartId or action" });
    if (action === "removeAll") {
      const cartItems = await getActiveCart(cartId);
      await Promise.all(cartItems.map((i) => deleteProduct(cartId, i.product_id)));
      return res.status(200).json({ success: true, cartId, uniqueDeviceId, resource: "", data: { status: "success", error: "" } });
    }
    if (action === "removeProduct") {
      if (!itemId) return res.status(400).json({ success: false, error: "Missing itemId" });
      await deleteProduct(cartId, itemId);
      return res.status(200).json({ success: true, cartId, uniqueDeviceId, resource: itemId, data: { status: "success", error: "" } });
    }
    return res.status(400).json({ success: false, error: `Unknown action: ${action}` });
  } catch (err) {
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
}

export async function updateProduct(req: Request, res: Response): Promise<Response> {
  try {
    const { uniqueDeviceId, cartId, productId, quantity } = req.body as Record<string, string>;
    if (!cartId || !productId || quantity === undefined) return res.status(400).json({ success: false, error: "Missing cartId, productId or quantity" });
    await updateProductQuantity(cartId, productId, parseInt(quantity));
    const cartItems = await getActiveCart(cartId);
    const itemCount = cartItems.reduce((sum, i) => sum + i.quantity, 0);
    return res.status(200).json({ success: true, cartId, uniqueDeviceId, resource: productId, data: { status: "success", error: "", itemCount: String(itemCount) } });
  } catch (err) {
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
}

export async function decrementProductHandler(req: Request, res: Response): Promise<Response> {
  try {
    const { uniqueDeviceId, cartId, productId } = req.body as Record<string, string>;
    if (!cartId || !productId) return res.status(400).json({ success: false, error: "Missing cartId or productId" });
    await decrementProduct(cartId, productId);
    const cartItems = await getActiveCart(cartId);
    const itemCount = cartItems.reduce((sum, i) => sum + i.quantity, 0);
    return res.status(200).json({ success: true, cartId, uniqueDeviceId, resource: productId, data: { status: "success", error: "", itemCount: String(itemCount) } });
  } catch (err) {
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
}

export async function processCart(req: Request, res: Response): Promise<Response> {
  try {
    const { uniqueDeviceId, cartId } = req.body as Record<string, string>;
    if (!cartId) return res.status(400).json({ success: false, error: "Missing cartId" });
    await markCartProcessed(cartId);
    return res.status(200).json({ success: true, cartId, uniqueDeviceId, resource: "", data: { status: "success", error: "" } });
  } catch (err) {
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
}
