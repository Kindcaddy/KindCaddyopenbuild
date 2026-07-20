"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Sparkles, Briefcase, Users, Home, Plug } from "lucide-react";
import UserProfileDropdown from "@/components/UserProfileDropdown";

interface UserContext {
  user: {
    id: string;
    email: string;
    name: string;
  };
  role: "admin" | "employee";
}

export default function RoleLandingPage() {
  const [userCtx, setUserCtx] = useState<UserContext | null>(null);

  useEffect(() => {
    const load = async () => {
      const response = await fetch("/api/me", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as UserContext;
      setUserCtx(data);
    };
    load();
  }, []);

  const isAdmin = userCtx?.role === "admin";
  const inferredRole = isAdmin ? "Admin" : "Employee";
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
              <Link
                href="/app/integrations"
                className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white px-3 py-2 rounded-md text-sm font-medium transition-colors"
                title="Integrations"
              >
                <Plug className="h-5 w-5" />
              </Link>
              <Link
                href="/"
                className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white px-3 py-2 rounded-md text-sm font-medium transition-colors"
              >
                <Home className="h-5 w-5" />
              </Link>
              <UserProfileDropdown />
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content - Role Selection */}
      <div className="flex items-center justify-center min-h-[calc(100vh-4rem)] px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-4xl space-y-8">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Select workspace role
            </h1>
            <p className="mt-2 text-gray-600 dark:text-gray-400">
              RBAC detected from login email:{" "}
              <span className="font-semibold text-blue-600 dark:text-blue-400">
                {inferredRole}
              </span>
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-8">
            <Link
              href="/app/assistant?role=admin"
              aria-disabled={!isAdmin}
              className={`group relative w-full sm:w-80 h-64 rounded-3xl overflow-hidden shadow-2xl transition-all duration-300 ${
                isAdmin
                  ? "hover:shadow-3xl hover:scale-105"
                  : "opacity-60 cursor-not-allowed pointer-events-none"
              }`}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500 via-fuchsia-500 to-pink-500 opacity-90" />
              <div className="relative h-full flex flex-col items-center justify-center p-8 text-white">
                <Briefcase className="h-16 w-16 mb-4" />
                <span className="text-3xl font-bold tracking-wide">Admin</span>
                <span className="mt-3 text-sm bg-white/20 rounded-full px-3 py-1">
                  {isAdmin ? "Allowed for this login" : "Not available"}
                </span>
              </div>
            </Link>

            <Link
              href="/app/assistant?role=employee"
              className="group relative w-full sm:w-80 h-64 rounded-3xl overflow-hidden shadow-2xl hover:shadow-3xl transition-all duration-300 hover:scale-105"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500 via-cyan-500 to-teal-500 opacity-90" />
              <div className="relative h-full flex flex-col items-center justify-center p-8 text-white">
                <Users className="h-16 w-16 mb-4" />
                <span className="text-3xl font-bold tracking-wide">Employee</span>
                <span className="mt-3 text-sm bg-white/20 rounded-full px-3 py-1">
                  Available for all users
                </span>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
