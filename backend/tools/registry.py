from backend.tools.builtin import calculator, web_search

registry: dict[str, object] = {
    "calculator": calculator,
    "web_search": web_search,
}
