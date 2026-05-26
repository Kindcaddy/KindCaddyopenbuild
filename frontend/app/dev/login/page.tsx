"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LogIn, LogOut, User } from "lucide-react";

interface UserInfo {
  id: string;
  email: string;
  name: string;
  tenantId?: string;
  tenantName?: string;
  role?: string;
}

interface UserWithTenants {
  id: string;
  email: string;
  name: string;
  tenants: Array<{
    id: string;
    name: string;
    departmentId: string;
    departmentName: string;
    role: string;
  }>;
}

export default function DevLoginPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<UserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [usersWithTenants, setUsersWithTenants] = useState<UserWithTenants[]>([]);

  useEffect(() => {
    // Only show in development
    if (process.env.NODE_ENV === "production") {
      router.push("/");
      return;
    }

    // Check current user
    fetchCurrentUser();
  }, [router]);

  const fetchCurrentUser = async () => {
    try {
      const res = await fetch("/api/dev/whoami");
      if (res.ok) {
        const data = await res.json();
        setCurrentUser({
          id: data.user.id,
          email: data.user.email,
          name: data.user.name,
          tenantId: data.tenant.id,
          tenantName: data.tenant.name,
          role: data.role,
        });
      }
    } catch (error) {
      // Not logged in
      setCurrentUser(null);
    }
  };

  const handleLogin = async (email: string, tenantId?: string) => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/dev/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, tenantId }),
      });

      if (res.ok) {
        await fetchCurrentUser();
        router.refresh();
      } else {
        const data = await res.json();
        alert(`Login failed: ${data.error}`);
      }
    } catch (error) {
      alert("Login failed. Please check the console.");
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    setIsLoading(true);
    try {
      await fetch("/api/dev/logout", { method: "POST" });
      setCurrentUser(null);
      router.refresh();
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await fetch("/api/dev/users");
        if (res.ok) {
          const data = await res.json();
          setUsersWithTenants(data.users);
        }
      } catch (error) {
        console.error("Failed to fetch users:", error);
      }
    };
    fetchUsers();
  }, []);

  if (process.env.NODE_ENV === "production") {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6 mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
            Dev Login - Quick User Switcher
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            This page is only available in development mode. Use it to quickly
            switch between users and tenants for testing.
          </p>

          {currentUser && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <User className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-white">
                      {currentUser.name}
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {currentUser.email}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-500">
                      {currentUser.tenantName} • {currentUser.role}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  disabled={isLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  <LogOut className="h-4 w-4" />
                  Logout
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {usersWithTenants.map((user) => (
            <div
              key={user.email}
              className="bg-white dark:bg-gray-800 shadow rounded-lg p-6"
            >
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                {user.name}
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                {user.email}
              </p>

              <div className="space-y-2">
                {user.tenants.map((tenant) => (
                  <button
                    key={tenant.id}
                    onClick={() => handleLogin(user.email, tenant.id)}
                    disabled={
                      isLoading ||
                      (currentUser?.email === user.email &&
                        currentUser?.tenantId === tenant.id)
                    }
                    className={`w-full flex items-center justify-between px-4 py-2 rounded-lg border transition-colors ${
                      currentUser?.email === user.email &&
                      currentUser?.tenantId === tenant.id
                        ? "bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700"
                        : "bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600"
                    } disabled:opacity-50`}
                  >
                    <div className="text-left">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {tenant.name}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {tenant.departmentName} • {tenant.role}
                      </p>
                    </div>
                    <LogIn className="h-4 w-4 text-gray-400" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
