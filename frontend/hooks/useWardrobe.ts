/**
 * hooks/useWardrobe.ts — Wardrobe data hook
 * ==========================================
 * Fetches and manages the user's clothing items.
 */

import { useState, useEffect, useCallback } from "react";
import { getWardrobeItems, uploadClothingItem, deleteClothingItem, ClothingItem } from "@/services/api";
import toast from "react-hot-toast";

export function useWardrobe() {
  const [items, setItems]     = useState<ClothingItem[]>([]);
  const [loading, setLoading] = useState(false);

  /** Fetch latest wardrobe from API */
  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getWardrobeItems();
      setItems(data);
    } catch {
      toast.error("Failed to load wardrobe");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  /** Upload a new item, then refresh the list */
  const uploadItem = useCallback(async (file: File, overrides?: { category?: string }) => {
    const toastId = toast.loading("Uploading & tagging your item…");
    try {
      const newItem = await uploadClothingItem(file, overrides);
      setItems((prev) => [newItem, ...prev]);
      toast.success("Item added to wardrobe!", { id: toastId });
      return newItem;
    } catch {
      toast.error("Upload failed", { id: toastId });
      return null;
    }
  }, []);

  /** Remove an item */
  const removeItem = useCallback(async (itemId: string) => {
    try {
      await deleteClothingItem(itemId);
      setItems((prev) => prev.filter((i) => i.id !== itemId));
      toast.success("Item removed");
    } catch {
      toast.error("Could not remove item");
    }
  }, []);

  return { items, loading, fetchItems, uploadItem, removeItem };
}
