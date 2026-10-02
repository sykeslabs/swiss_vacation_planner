"""Vercel entrypoint: Vercel loads the top-level ``app`` variable from this file."""

from app import create_app

app = create_app()

if __name__ == "__main__":
    app.run(debug=True, port=5000)
