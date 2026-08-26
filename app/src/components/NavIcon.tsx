export type NavIconName =
  | 'register'
  | 'tables'
  | 'orders'
  | 'customers'
  | 'kitchen'
  | 'catalog'
  | 'shifts'
  | 'reports'
  | 'users'
  | 'staff'
  | 'settings'

/** Stroke paths in a 24×24 grid — colored by the nav item via currentColor. */
const PATHS: Record<NavIconName, string> = {
  // cash register / till drawer
  register:
    'M4 10h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9Zm0 0 1.5-5A1 1 0 0 1 6.5 4h11a1 1 0 0 1 .97.76L20 10M9 14h6',
  // round table with two seats
  tables:
    'M12 5a8 3 0 1 0 0 6 8 3 0 1 0 0-6Zm-8 3v6m16-6v6M8 18l1-4.5M16 18l-1-4.5',
  // receipt with zigzag foot
  orders:
    'M6 3h12v17l-2-1.4L14 20l-2-1.4L10 20l-2-1.4L6 20V3Zm3 5h6M9 11.5h6',
  // two people
  customers:
    'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5 9c0-3 2.2-5 5-5s5 2 5 5M16.5 10.5a2.6 2.6 0 1 0-1.8-4.9M15.5 15.3c2.6.2 4.5 2 4.5 4.7',
  // cloche / serving dome
  kitchen:
    'M4 16h16M5 16a7 7 0 0 1 14 0M12 9V7m-1.5-2h3M7 19h10',
  // price tag
  catalog:
    'M12 3h7a1 1 0 0 1 1 1v7l-9 9a1.4 1.4 0 0 1-2 0l-6-6a1.4 1.4 0 0 1 0-2l9-9Zm4 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  // clock
  shifts: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5l3.5 2',
  // bar chart
  reports: 'M4 20h16M7 20v-6m5 6V9m5 11v-9',
  // person with key badge
  users:
    'M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9c0-3.3 2.6-5.5 6-5.5 1.2 0 2.3.27 3.2.75M17 15.5a2.5 2.5 0 1 1 2.2 4.1L19 21h-2v-1.5',
  // ID badge with lanyard
  staff:
    'M7 7h10a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Zm3 0V5.5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5V7m-4.5 9.5c0-1.4 1.1-2.2 2.5-2.2s2.5.8 2.5 2.2M12 12.8a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8Z',
  // gear
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.14-1.43l2-1.55-2-3.46-2.35.95a7.4 7.4 0 0 0-2.48-1.44L14 2.5h-4l-.43 2.57a7.4 7.4 0 0 0-2.48 1.44l-2.35-.95-2 3.46 2 1.55a7.5 7.5 0 0 0 0 2.86l-2 1.55 2 3.46 2.35-.95c.74.63 1.58 1.12 2.48 1.44L10 21.5h4l.43-2.57a7.4 7.4 0 0 0 2.48-1.44l2.35.95 2-3.46-2-1.55c.09-.47.14-.95.14-1.43Z',
}

export function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
