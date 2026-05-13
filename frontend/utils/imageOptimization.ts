export function shouldBypassImageOptimization(src: string): boolean {
  if (!src) return false;
  return (
    src.startsWith("blob:") ||
    src.startsWith("data:") ||
    src.includes(".supabase.co/storage/v1/object/")
  );
}
