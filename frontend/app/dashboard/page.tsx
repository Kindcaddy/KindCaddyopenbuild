import Link from "next/link";
import { Sparkles, Bell, Search, TrendingUp, Users, DollarSign, Activity } from "lucide-react";

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Navigation */}
      <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Sparkles className="h-8 w-8 text-blue-600" />
              <span className="ml-2 text-xl font-bold text-gray-900 dark:text-white">
                KindCaddy
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
                JD
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
              href="/dashboard"
              className="flex items-center px-4 py-2 text-gray-900 dark:text-white bg-blue-50 dark:bg-blue-900/20 rounded-lg"
            >
              <Activity className="h-5 w-5 mr-3" />
              Dashboard
            </Link>
            <Link
              href="/dashboard/analytics"
              className="flex items-center px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg"
            >
              <TrendingUp className="h-5 w-5 mr-3" />
              Analytics
            </Link>
            <Link
              href="/dashboard/users"
              className="flex items-center px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg"
            >
              <Users className="h-5 w-5 mr-3" />
              Users
            </Link>
            <Link
              href="/dashboard/settings"
              className="flex items-center px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg"
            >
              <Sparkles className="h-5 w-5 mr-3" />
              Settings
            </Link>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-8">
          <div className="max-w-7xl mx-auto">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-8">
              Dashboard
            </h1>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                      Total Revenue
                    </p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                      $45,231
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
                      Active Users
                    </p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                      2,350
                    </p>
                    <p className="text-sm text-green-600 dark:text-green-400 mt-1">
                      +180.1% from last month
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
                      Growth Rate
                    </p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                      12.5%
                    </p>
                    <p className="text-sm text-green-600 dark:text-green-400 mt-1">
                      +2.4% from last month
                    </p>
                  </div>
                  <div className="h-12 w-12 bg-purple-100 dark:bg-purple-900 rounded-lg flex items-center justify-center">
                    <TrendingUp className="h-6 w-6 text-purple-600 dark:text-purple-400" />
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
                <div className="flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">
                      New user registered
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      2 minutes ago
                    </p>
                  </div>
                  <span className="px-3 py-1 bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-300 rounded-full text-xs font-medium">
                    User
                  </span>
                </div>
                <div className="flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">
                      Payment received
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      15 minutes ago
                    </p>
                  </div>
                  <span className="px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-300 rounded-full text-xs font-medium">
                    Payment
                  </span>
                </div>
                <div className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">
                      System update completed
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      1 hour ago
                    </p>
                  </div>
                  <span className="px-3 py-1 bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-300 rounded-full text-xs font-medium">
                    System
                  </span>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
