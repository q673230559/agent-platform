from langchain.tools import tool


@tool
def web_fetch(url: str) -> str:
    """
    Fetch and parse a web page, returning its text content as markdown.
    Args:
        url: the full URL of the page to fetch
    """
    try:
        import httpx
    except ImportError:
        return "web_fetch unavailable: httpx package not installed"

    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return "web_fetch unavailable: beautifulsoup4 package not installed"

    try:
        from markdownify import markdownify as md
    except ImportError:
        md = None

    try:
        resp = httpx.get(url, follow_redirects=True, timeout=15, headers={
            "User-Agent": "Mozilla/5.0 (compatible; agent-platform/1.0)",
        })
        resp.raise_for_status()
        html = resp.text
        soup = BeautifulSoup(html, "html.parser")

        # Strip script/style tags
        for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
            tag.decompose()

        body = soup.find("body") or soup
        if md:
            text = md(str(body), heading_style="ATX")
        else:
            text = body.get_text(separator="\n", strip=True)

        # Truncate to reasonable length
        max_chars = 8000
        if len(text) > max_chars:
            text = text[:max_chars] + f"\n\n[Truncated at {max_chars} chars, original page has {len(text)} chars]"

        return text
    except httpx.HTTPStatusError as e:
        return f"HTTP error {e.response.status_code} for {url}"
    except httpx.RequestError as e:
        return f"Request error for {url}: {e}"
    except Exception as e:
        return f"Error fetching {url}: {e}"
