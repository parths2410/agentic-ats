from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import candidates, chat, criteria, health, roles, scoring, websocket
from app.config import settings
from app.database import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Agentic ATS API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(roles.router, prefix="/api")
app.include_router(criteria.router, prefix="/api")
app.include_router(candidates.router, prefix="/api")
app.include_router(scoring.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(websocket.router)
