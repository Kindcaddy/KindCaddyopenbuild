"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Sparkles, ArrowLeft, User, Mail, Building2, Users, Shield, CheckCircle2 } from "lucide-react";
import UserProfileDropdown from "@/components/UserProfileDropdown";

interface UserData {
  user: {
    id: string;
    email: string;
    name: string;
  };
  tenant: {
    id: string;
    name: string;
  };
  department: {
    id: string;
    name: string;
  };
  role: string;
  permissions: string[];
}

export default function ProfilePage() {
  const [userData, setUserData] = useState<UserData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const response = await fetch("/api/me");
        if (!response.ok) {
          if (response.status === 401) {
            router.push("/login");
            return;
          }
          throw new Error("Failed to fetch user data");
        }
        const data = await response.json();
        setUserData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setIsLoading(false);
      }
    };

    fetchUserData();
  }, [router]);

  const getInitials = (name: string): string => {
    const parts = name.trim().split(" ");
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  const getRoleColor = (role: string): string => {
    switch (role.toLowerCase()) {
      case "admin":
        return "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300";
      case "employee":
        return "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300";
      default:
        return "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300";
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center">
                <Sparkles className="h-8 w-8 text-blue-600" />
                <span className="ml-2 text-xl font-bold text-gray-900 dark:text-white">
                  KindCaddy
                </span>
              </div>
              <div className="flex items-center gap-4">
                <Link
                  href="/app"
                  className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Link>
                <div className="h-8 w-8 rounded-full bg-gray-300 dark:bg-gray-600 animate-pulse"></div>
              </div>
            </div>
          </div>
        </nav>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 p-8">
            <div className="animate-pulse space-y-4">
              <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
              <div className="h-24 bg-gray-200 dark:bg-gray-700 rounded"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !userData) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center">
                <Sparkles className="h-8 w-8 text-blue-600" />
                <span className="ml-2 text-xl font-bold text-gray-900 dark:text-white">
                  KindCaddy
                </span>
              </div>
              <div className="flex items-center gap-4">
                <Link
                  href="/app"
                  className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Link>
                <UserProfileDropdown />
              </div>
            </div>
          </div>
        </nav>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 p-8">
            <div className="text-center py-8">
              <p className="text-red-600 dark:text-red-400 mb-4">
                {error || "Failed to load profile data"}
              </p>
              <Link
                href="/app"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                Return to Dashboard
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const initials = getInitials(userData.user.name);

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
            <div className="flex items-center gap-4">
              <Link
                href="/app"
                className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              >
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <UserProfileDropdown />
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link
          href="/app"
          className="inline-flex items-center text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-6"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Dashboard
        </Link>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 p-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-8">
            Profile
          </h1>

          {/* Profile Picture */}
          <div className="mb-8">
            <div className="h-24 w-24 rounded-full bg-blue-600 flex items-center justify-center text-white text-3xl font-bold mb-4">
              {initials}
            </div>
          </div>

          {/* User Information */}
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  <User className="h-4 w-4 inline mr-2" />
                  Full Name
                </label>
                <div className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-gray-900 dark:text-white">
                  {userData.user.name}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  <Mail className="h-4 w-4 inline mr-2" />
                  Email Address
                </label>
                <div className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-gray-900 dark:text-white">
                  {userData.user.email}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  <Building2 className="h-4 w-4 inline mr-2" />
                  Tenant
                </label>
                <div className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-gray-900 dark:text-white">
                  {userData.tenant.name}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  <Users className="h-4 w-4 inline mr-2" />
                  Department
                </label>
                <div className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-gray-900 dark:text-white">
                  {userData.department.name}
                </div>
              </div>
            </div>

            {/* Role Badge */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                <Shield className="h-4 w-4 inline mr-2" />
                Role
              </label>
              <div className="inline-block">
                <span
                  className={`px-4 py-2 rounded-lg font-semibold capitalize ${getRoleColor(
                    userData.role
                  )}`}
                >
                  {userData.role}
                </span>
              </div>
            </div>

            {/* Permissions */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Permissions
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {userData.permissions && userData.permissions.length > 0 ? (
                  userData.permissions.map((permission, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-2 px-4 py-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg"
                    >
                      <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                      <span className="text-sm text-green-700 dark:text-green-300">
                        {permission}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    No permissions assigned
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
