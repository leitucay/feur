# Role-based access update

Roles
- Superadmin (school): everything an admin can do (dashboard, POS, products, inventory, sales, customers, reports, settings, accounts) for ANY store via the "Managing" store switcher / Manage Store button, plus `pages/superadmin.html`: add stores + owner logins, record rent payments, Paid / Pending / Partial / Overdue per store, sales per store, disable/enable/delete stores, reset owner password.
- Admin (store owner, role "Administrator"): the existing full admin pages, but only for their own store's data and accounts.
- Cashier (role "Staff"): unchanged POS view.

Default logins
- superadmin / superadmin123  (change it after first login)
- admin / admin123 and staff / staff123  (belong to "FEU Canteen - Store 1", your old data is moved there automatically)

New: js/store-scope.js, pages/superadmin.html
Changed: js/app.js, pages/login.html, pages/account.html, pages/customer-display.html,
         and one added <script src=".../store-scope.js"> line in the other pages.
