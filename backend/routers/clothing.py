"""
routers/clothing.py — Wardrobe item endpoints
==============================================
POST   /clothing/tag-preview   — run AI tagging on an image, return tags WITHOUT saving
POST   /clothing/upload-item   — save item with final (possibly corrected) tags
GET    /clothing/items         — list user's wardrobe
PATCH  /clothing/item/{id}     — correct category/color on an existing item
DELETE /clothing/item/{id}     — remove an item
GET    /clothing/tag-options   — return valid category + color values for dropdowns
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from typing import List, Optional

from services.clothing_service import (
    upload_clothing_item, get_user_items, delete_item, correct_item_tags
)
from ml.tagger import tag_clothing_item, get_taggable_options
from utils.auth import get_current_user_id

router = APIRouter()


@router.get("/tag-options")
def tag_options():
    """
    Return the valid category and color values the AI understands.
    The frontend uses this to populate correction dropdowns — this way
    the UI labels always stay in sync with the model's label space.
    """
    return get_taggable_options()


@router.post("/tag-preview")
async def tag_preview(
    file: UploadFile = File(..., description="Clothing image to analyse"),
    user_id: str = Depends(get_current_user_id),
):
    """
    Run AI tagging on an uploaded image and return the predicted tags.
    Nothing is saved to the database — this is a pure preview step.

    The frontend shows these results to the user, who can then correct
    category and color before calling /upload-item to actually save.
    """
    image_bytes = await file.read()

    # Use a placeholder URL as mock seed (real mode ignores this)
    tags = tag_clothing_item(
        image_url=f"preview://{file.filename}",
        image_bytes=image_bytes,
    )

    # Map numeric formality score → human label matching frontend FORMALITY_DESCRIPTIONS
    formality_score = tags.get("formality_score", 0.5)
    formality_label = (
        "Black tie"       if formality_score >= 0.85 else
        "Business formal" if formality_score >= 0.65 else
        "Smart casual"    if formality_score >= 0.42 else
        "Casual"          if formality_score >= 0.20 else
        "Loungewear"
    )

    # Check for duplicate before returning.
    # Pass the detected colour so items that differ only in colour are NOT flagged.
    from services.clothing_service import find_duplicate
    duplicate = find_duplicate(user_id=user_id, image_bytes=image_bytes, new_color=tags.get("color"))

    from ml.llm import describe_clothing
    descriptors = describe_clothing(image_bytes, tags.get("category", "tops"), file.content_type or "image/jpeg")

    return {
        **tags,
        "descriptors": descriptors,
        "formality_label": formality_label,
        "duplicate": duplicate,
    }


@router.post("/upload-item", status_code=201)
async def upload_item(
    file:              UploadFile = File(..., description="Clothing image (JPG/PNG)"),
    category:          Optional[str] = Form(None),
    color:             Optional[str] = Form(None),
    pattern:           Optional[str] = Form(None, description="e.g. 'stripes', 'floral'"),
    season:            Optional[str] = Form(None),
    formality_label:   Optional[str] = Form(None, description="e.g. 'Smart casual'"),
    item_type:         Optional[str] = Form(None),
    accessory_subtype: Optional[str] = Form(None),
    user_id: str = Depends(get_current_user_id),
):
    """
    Upload, tag, embed and persist a clothing item.

    Typical flow:
      1. Frontend calls /tag-preview to get AI tags + shows them to user
      2. User can correct category and color
      3. Frontend calls /upload-item with the (possibly corrected) values
      4. Backend re-runs AI for season + formality, applies user overrides for
         category + color, generates embedding, then saves everything

    User overrides (category, color) always win over AI detection.
    """
    image_bytes = await file.read()

    # Build overrides from all user-provided fields
    _FORMALITY_SCORE_MAP_LOCAL = {
        "Black tie": 0.95, "Business formal": 0.75, "Smart casual": 0.55,
        "Casual": 0.30, "Loungewear": 0.10,
    }
    manual_tags: dict = {}
    if category:          manual_tags["category"]          = category
    if color:             manual_tags["color"]             = color
    if pattern:           manual_tags["pattern"]           = pattern
    if item_type:         manual_tags["item_type"]         = item_type
    if accessory_subtype: manual_tags["accessory_subtype"] = accessory_subtype

    if season: manual_tags["season"] = season
    if formality_label and formality_label in _FORMALITY_SCORE_MAP_LOCAL:
        manual_tags["formality_score"] = _FORMALITY_SCORE_MAP_LOCAL[formality_label]

    item = upload_clothing_item(
        user_id=user_id,
        image_bytes=image_bytes,
        filename=file.filename,
        manual_tags=manual_tags or None,
    )
    return item


# Formality label → numeric score (must match FORMALITY_DESCRIPTIONS in tagger.py)
_FORMALITY_SCORE_MAP = {
    "Black tie":        0.95,
    "Business formal":  0.75,
    "Smart casual":     0.55,
    "Casual":           0.30,
    "Loungewear":       0.10,
}


@router.patch("/item/{item_id}")
def correct_item(
    item_id:         str,
    category:        Optional[str] = None,
    color:           Optional[str] = None,
    season:          Optional[str] = None,
    pattern:         Optional[str] = None,
    formality_label: Optional[str] = None,
    user_id: str = Depends(get_current_user_id),
):
    """
    Correct any tag on an already-saved item.
    All fields are now user-editable: category, color, season, formality.
    formality_label is the human string (e.g. 'Smart casual') — backend maps to score.
    """
    corrections: dict = {}
    if category: corrections["category"] = category
    if color:    corrections["color"]    = color
    if pattern:  corrections["pattern"]  = pattern
    if season:   corrections["season"]   = season
    if formality_label and formality_label in _FORMALITY_SCORE_MAP:
        corrections["formality_score"] = _FORMALITY_SCORE_MAP[formality_label]

    if not corrections:
        raise HTTPException(status_code=400, detail="Provide at least one correction field")

    updated = correct_item_tags(item_id=item_id, user_id=user_id, corrections=corrections)
    if not updated:
        raise HTTPException(status_code=404, detail="Item not found")
    return updated


@router.get("/items", response_model=List[dict])
def list_items(user_id: str = Depends(get_current_user_id)):
    """Return all clothing items in the authenticated user's wardrobe."""
    return get_user_items(user_id)


@router.delete("/item/{item_id}", status_code=204)
def remove_item(item_id: str, user_id: str = Depends(get_current_user_id)):
    """Delete an item. Returns 404 if not found or not owned by this user."""
    deleted = delete_item(item_id, user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Item not found")

