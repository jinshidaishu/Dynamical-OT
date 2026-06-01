const currentPage = document.body.dataset.page;
const sidebar = document.querySelector(".site-sidebar");
const toggle = document.querySelector(".toc-toggle");

document.querySelectorAll(".toc-link").forEach((link) => {
  if (link.dataset.page === currentPage) {
    link.classList.add("is-active");
  }
});

if (sidebar) {
  sidebar.id = "site-sidebar";
}

toggle?.addEventListener("click", () => {
  const isOpen = document.body.classList.toggle("sidebar-open");
  toggle.setAttribute("aria-expanded", String(isOpen));
});

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest(".site-sidebar") || target.closest(".toc-toggle")) return;
  document.body.classList.remove("sidebar-open");
  toggle?.setAttribute("aria-expanded", "false");
});
