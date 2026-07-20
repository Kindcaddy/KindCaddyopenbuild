# Kindcaddy Frontend for small and mid size business

A modern SaaS platform frontend built with Next.js, TypeScript, and Tailwind CSS.

## Features

- 🚀 Next.js 14 with App Router
- 💎 TypeScript for type safety
- 🎨 Tailwind CSS for styling
- 🌙 Dark mode support
- 📱 Responsive design
- 🔐 Authentication pages (Login/Signup)
- 📊 Dashboard with analytics

## Getting Started

### Install Dependencies

```bash
npm install
```

### Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Build for Production

```bash
npm run build
npm start
```

## Project Structure

```
frontend/
├── app/
│   ├── app/           # Customer/User Interface
│   │   ├── page.tsx   # Customer dashboard
│   │   ├── profile/   # User profile page
│   │   ├── billing/   # Billing & subscription(intneral billing to department connceting to netsuite transactions)
│   │   └── settings/  # User settings
│   ├── admin/         # Admin Interface
│   │   ├── page.tsx   # Admin dashboard
│   │   ├── users/     # User management
│   │   ├── analytics/ # Analytics & reports
│   │   └── settings/  # Admin settings
│   ├── login/         # Login page
│   ├── layout.tsx     # Root layout
│   ├── page.tsx       # Landing page
│   └── globals.css    # Global styles
├── components/        # Reusable components
│   └── ui/           # UI components (Button, Card, etc.)
├── public/           # Static assets
└── package.json      # Dependencies
```

## Two User Interfaces

### 1. Customer/User Interface (`/app/*`)
Designed for end-users to manage their accounts and use the platform:
- **`/app`** - Customer dashboard with overview, projects, and quick actions
- **`/app/profile`** - User profile management
- **`/app/billing`** - Subscription and billing management
- **`/app/settings`** - User preferences and settings

**Features:**
- Personal dashboard with activity overview
- Account management
- Project/file management
- Subscription management
- User-friendly, simplified interface

### 2. Admin Interface (`/admin/*`)
Designed for administrators to manage the platform:
- **`/admin`** - Admin dashboard with system-wide metrics
- **`/admin/users`** - User management and administration
- **`/admin/analytics`** - Platform analytics and reports
- **`/admin/settings`** - System configuration

**Features:**
- System-wide statistics and monitoring
- User management (CRUD operations)
- Security and system alerts
- Advanced analytics
- Platform configuration

## Pages

### Public Pages
- `/` - Landing page
- `/login` - Login page

### Customer Interface
- `/app` - Customer dashboard
- `/app/profile` - User profile
- `/app/billing` - Billing & subscription
- `/app/settings` - User settings

### Admin Interface
- `/admin` - Admin dashboard
- `/admin/users` - User management
- `/admin/analytics` - Analytics
- `/admin/settings` - Admin settings

## Tech Stack

- **Framework**: Next.js 14
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Icons**: Lucide React (to be installed)

## Next Steps

- Add authentication logic
- Connect to backend API
- Add more dashboard features
- Implement user management
- Add payment integration
