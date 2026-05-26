import Link from "next/link";
import { Sparkles, Bell, Search, TrendingUp, Users, DollarSign, Activity, Settings, BarChart3, Shield } from "lucide-react";

export default function AdminDashboard() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Navigation */}
      <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Sparkles className="h-8 w-8 text-blue-600" />
              <span className="ml-2 text-xl font-bold text-gray-900 dark:text-white">
                KindCaddy Admin
              </span>
            </div>
            <div className="flex items-center space-x-4">
              <button className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white">
                <Search className="h-5 w-5" />
              </button>
              <button className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white relative">
                <Bell className="h-5 w-5" />
                <span className="absolute top-1 right-1 h-2 w-2 bg-red-500 rounded-full"></span>
              </button>
              <div className="h-8 w-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-semibold">
                AD
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Sidebar & Main Content */}
      <div className="flex">
        {/* Sidebar */}
        <aside className="w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 min-h-[calc(100vh-4rem)]">
          <nav className="p-4 space-y-2">
            <Link
              href="/admin"
              className="flex items-center px-4 py-2 text-gray-900 dark:text-white bg-blue-50 dark:bg-blue-900/20 rounded-lg"
            >
              <Activity className="h-5 w-5 mr-3" />
              Dashboard
            </Link>
            <Link
              href="/admin/users"
              className="flex items-center px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg"
            >
              <Users className="h-5 w-5 mr-3" />
              User Management
            </Link>
            <Link
              href="/admin/analytics"
              className="flex items-center px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg"
            >
              <BarChart3 className="h-5 w-5 mr-3" />
              Analytics
            </Link>
            <Link
              href="/admin/security"
              className="flex items-center px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg"
            >
              <Shield className="h-5 w-5 mr-3" />
              Security
            </Link>
            <Link
              href="/admin/settings"
              className="flex items-center px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg"
            >
              <Settings className="h-5 w-5 mr-3" />
              Settings
            </Link>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-8">
          <div className="max-w-7xl mx-auto">
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                Admin Dashboard
              </h1>
              <p className="text-gray-600 dark:text-gray-400">
                Manage your platform and monitor system health
              </p>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                      Total Revenue
                    </p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                      $125,431
                    </p>
                    <p className="text-sm text-green-600 dark:text-green-400 mt-1">
                      +20.1% from last month
                    </p>
                  </div>
                  <div className="h-12 w-12 bg-green-100 dark:bg-green-900 rounded-lg flex items-center justify-center">
                    <DollarSign className="h-6 w-6 text-green-600 dark:text-green-400" />
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                      Total Users
                    </p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                      8,350
                    </p>
                    <p className="text-sm text-green-600 dark:text-green-400 mt-1">
                      +180 new users
                    </p>
                  </div>
                  <div className="h-12 w-12 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
                    <Users className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                      Active Sessions
                    </p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                      1,234
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">
                      Currently online
                    </p>
                  </div>
                  <div className="h-12 w-12 bg-purple-100 dark:bg-purple-900 rounded-lg flex items-center justify-center">
                    <Activity className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                      System Health
                    </p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                      99.9%
                    </p>
                    <p className="text-sm text-green-600 dark:text-green-400 mt-1">
                      All systems operational
                    </p>
                  </div>
                  <div className="h-12 w-12 bg-green-100 dark:bg-green-900 rounded-lg flex items-center justify-center">
                    <Shield className="h-6 w-6 text-green-600 dark:text-green-400" />
                  </div>
                </div>
              </div>
            </div>

            {/* Two Column Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {/* Recent Users */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                    Recent Users
                  </h2>
                  <Link
                    href="/admin/users"
                    className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700"
                  >
                    View all
                  </Link>
                </div>
                <div className="space-y-4">
                  {[
                    { name: "Sarah Johnson", email: "sarah@example.com", time: "2 min ago" },
                    { name: "Mike Chen", email: "mike@example.com", time: "15 min ago" },
                    { name: "Emily Davis", email: "emily@example.com", time: "1 hour ago" },
                  ].map((user, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700 last:border-0"
                    >
                      <div className="flex items-center space-x-3">
                        <div className="h-10 w-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-semibold">
                          {user.name.split(" ").map((n) => n[0]).join("")}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">
                            {user.name}
                          </p>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            {user.email}
                          </p>
                        </div>
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-500">
                        {user.time}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* System Alerts */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 p-6">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                  System Alerts
                </h2>
                <div className="space-y-4">
                  <div className="flex items-start space-x-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                    <div className="h-2 w-2 bg-green-500 rounded-full mt-2"></div>
                    <div className="flex-1">
                      <p className="font-medium text-gray-900 dark:text-white">
                        Backup completed successfully
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        5 minutes ago
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                    <div className="h-2 w-2 bg-yellow-500 rounded-full mt-2"></div>
                    <div className="flex-1">
                      <p className="font-medium text-gray-900 dark:text-white">
                        High API usage detected
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        1 hour ago
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                    <div className="h-2 w-2 bg-blue-500 rounded-full mt-2"></div>
                    <div className="flex-1">
                      <p className="font-medium text-gray-900 dark:text-white">
                        New feature deployed
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        2 hours ago
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Recent Activity */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                Recent Activity
              </h2>
              <div className="space-y-4">
                {[
                  { action: "New user registered", type: "User", time: "2 minutes ago" },
                  { action: "Payment received - $299", type: "Payment", time: "15 minutes ago" },
                  { action: "System update completed", type: "System", time: "1 hour ago" },
                  { action: "Security audit completed", type: "Security", time: "3 hours ago" },
                ].map((activity, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700 last:border-0"
                  >
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">
                        {activity.action}
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {activity.time}
                      </p>
                    </div>
                    <span className="px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-300 rounded-full text-xs font-medium">
                      {activity.type}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
