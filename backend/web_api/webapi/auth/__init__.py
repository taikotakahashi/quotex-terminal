"""User authentication (register / login / email verify / sessions)."""

from .routes import router as auth_router
from .admin_routes import router as admin_router

# Combined for app.include_router convenience — main includes both.
router = auth_router

__all__ = ["router", "auth_router", "admin_router"]
