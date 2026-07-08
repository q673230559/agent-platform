from backend.tools.builtin import (
    calculator,
    web_search,
    read_file,
    write_file,
    edit_file,
    glob_files,
    grep_files,
    web_fetch,
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
}
