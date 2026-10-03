// "Was ist geplant?": the to-do list from todos.js in a movable modal. Static, text only.
import { createDialog, el } from "./dialog.js";
import { TODOS } from "./todos.js";

export function createTodoModal({ todos = TODOS } = {}) {
  const dialog = createDialog({ title: "Was ist geplant?", className: "todo-modal", movable: true });
  for (const { group, items } of todos) {
    const list = el("ul", "help-list");
    list.append(...items.map((t) => el("li", "", t)));
    dialog.body.append(el("h3", "help-heading", group), list);
  }
  return { open: (from) => dialog.open(from), close: () => dialog.close(), isOpen: dialog.isOpen };
}
