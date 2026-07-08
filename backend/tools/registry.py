from backend.tools.builtin import (
    calculator,
    web_search,
    read_file,
    write_file,
    edit_file,
    glob_files,
    grep_files,
    web_fetch,
    poetry_search,
    poetry_random,
    poetry_get,
    poetry_authors,
)

registry: dict[str, object] = {
    "calculator": calculator,
    "web_search": web_search,
    "read_file": read_file,
    "write_file": write_file,
    "edit_file": edit_file,
    "glob_files": glob_files,
    "grep_files": grep_files,
    "web_fetch": web_fetch,
    "poetry_search": poetry_search,
    "poetry_random": poetry_random,
    "poetry_get": poetry_get,
    "poetry_authors": poetry_authors,
}
