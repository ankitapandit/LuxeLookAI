cd backend
venv/bin/python - << 'EOF'
import os
from dotenv import load_dotenv
load_dotenv(".env")

url = os.getenv("SUPABASE_URL")
anon = os.getenv("SUPABASE_ANON_KEY")
service = os.getenv("SUPABASE_SERVICE_KEY")

print(f"URL:         {url}")
print(f"Anon key:    {anon[:20]}..." if anon else "Anon key:    MISSING")
print(f"Service key: {service[:20]}..." if service else "Service key: MISSING")

from supabase import create_client
try:
    db = create_client(url, service)
    # Try a simple query against a table that should exist
    result = db.table("clothing_items").select("id").limit(1).execute()
    print("\n✓ Connection successful!")
    print(f"  clothing_items table reachable (rows returned: {len(result.data)})")
except Exception as e:
    print(f"\n✗ Connection failed: {e}")
EOF