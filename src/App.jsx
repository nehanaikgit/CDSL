import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  LayoutDashboard,
  RefreshCcw,
  Search,
  UsersRound,
} from 'lucide-react'

const processes = [
  {
    id: 'cash',
    name: 'Cash Segment Billing',
    code: 'CSB',
    completed: 18,
    total: 23,
    overdue: 1,
    activeStep: 'CSB_19',
    status: 'active',
  },
  {
    id: 'fod',
    name: 'F&O Daily Billing',
    code: 'FOD',
    completed: 12,
    total: 26,
    overdue: 2,
    activeStep: 'FOD_13',
    status: 'delayed',
  },
  {
    id: 'auction',
    name: 'Auction Closeout',
    code: 'AC',
    completed: 9,
    total: 14,
    overdue: 0,
    activeStep: 'AC_10',
    status: 'active',
  },
  {
    id: 'mtf',
    name: 'MTF Billing Process',
    code: 'MTF',
    completed: 21,
    total: 21,
    overdue: 0,
    activeStep: 'Completed',
    status: 'completed',
  },
]

const steps = [
  {
    stepNo: 1,
    stepId: 'CSB_01',
    stepName: 'Download trade file',
    assignedTo: 'doer1@geplcapital.com',
    assignmentType: 'SELF',
    plannedTime: '09:30 AM',
    actualTime: '09:28 AM',
    delay: '0 min',
    status: 'completed',
  },
  {
    stepNo: 2,
    stepId: 'CSB_02',
    stepName: 'Validate exchange file',
    assignedTo: 'doer2@geplcapital.com',
    assignmentType: 'SELF',
    plannedTime: '09:45 AM',
    actualTime: '09:52 AM',
    delay: '7 min',
    status: 'delayed',
  },
  {
    stepNo: 3,
    stepId: 'CSB_03',
    stepName: 'Upload billing data',
    assignedTo: 'doer3@geplcapital.com',
    assignmentType: 'BUDDY',
    plannedTime: '10:15 AM',
    actualTime: '-',
    delay: '-',
    status: 'active',
  },
  {
    stepNo: 4,
    stepId: 'CSB_04',
    stepName: 'Manager verification',
    assignedTo: 'manager@geplcapital.com',
    assignmentType: 'REPORTING',
    plannedTime: '10:45 AM',
    actualTime: '-',
    delay: '-',
    status: 'waiting',
  },
]

const statusClass = {
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  active: 'bg-blue-50 text-blue-700 border-blue-200',
  delayed: 'bg-orange-50 text-orange-700 border-orange-200',
  waiting: 'bg-slate-100 text-slate-600 border-slate-200',
}

const statusLabel = {
  completed: 'Completed',
  active: 'Active',
  delayed: 'Delayed',
  waiting: 'Waiting',
}

function App() {
  const totalProcesses = processes.length

  const completedProcesses = processes.filter(
    (process) => process.status === 'completed',
  ).length

  const activeProcesses = processes.filter(
    (process) => process.status === 'active' || process.status === 'delayed',
  ).length

  const totalOverdue = processes.reduce(
    (sum, process) => sum + process.overdue,
    0,
  )

  return (
    <main className="min-h-screen bg-slate-50">
      <aside className="fixed left-0 top-0 hidden h-screen w-64 border-r border-slate-200 bg-white p-6 lg:block">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600 text-white">
            <LayoutDashboard size={22} />
          </div>

          <div>
            <h1 className="text-lg font-bold text-slate-950">CDSL FMS</h1>
            <p className="text-xs text-slate-500">Operations Dashboard</p>
          </div>
        </div>

        <nav className="mt-10 space-y-2">
          <button className="w-full rounded-xl bg-blue-50 px-4 py-3 text-left text-sm font-semibold text-blue-700">
            Dashboard
          </button>

          <button className="w-full rounded-xl px-4 py-3 text-left text-sm font-medium text-slate-600 hover:bg-slate-50">
            Processes
          </button>

          <button className="w-full rounded-xl px-4 py-3 text-left text-sm font-medium text-slate-600 hover:bg-slate-50">
            Reports
          </button>

          <button className="w-full rounded-xl px-4 py-3 text-left text-sm font-medium text-slate-600 hover:bg-slate-50">
            Settings
          </button>
        </nav>
      </aside>

      <section className="lg:pl-64">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 px-6 py-4 backdrop-blur">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-sm font-medium text-blue-600">
                Financial Operations Command Center
              </p>

              <h2 className="text-2xl font-bold text-slate-950">
                CDSL Process Monitoring Dashboard
              </h2>
            </div>

            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <select className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 outline-none">
                <option>Today</option>
                <option>Previous Day</option>
                <option>Previous Week</option>
                <option>Current Month</option>
              </select>

              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                <Search size={16} className="text-slate-400" />

                <input
                  className="w-56 border-0 bg-transparent text-sm outline-none"
                  placeholder="Search process, step, doer..."
                />
              </div>

              <button className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700">
                <RefreshCcw size={16} />
                Refresh
              </button>
            </div>
          </div>
        </header>

        <div className="space-y-6 p-6">
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              icon={<LayoutDashboard size={22} />}
              label="Total Processes"
              value={String(totalProcesses)}
            />

            <KpiCard
              icon={<CheckCircle2 size={22} />}
              label="Completed"
              value={String(completedProcesses)}
            />

            <KpiCard
              icon={<Clock3 size={22} />}
              label="Active"
              value={String(activeProcesses)}
            />

            <KpiCard
              icon={<AlertTriangle size={22} />}
              label="Overdue"
              value={String(totalOverdue)}
            />
          </section>

          <section>
            <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-950">
                  Process Overview
                </h3>

                <p className="text-sm text-slate-500">
                  Frontend base UI with sample process data. BigQuery connection
                  will be added after this setup is complete.
                </p>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-4">
              {processes.map((process) => {
                const progress = Math.round(
                  (process.completed / process.total) * 100,
                )

                return (
                  <article
                    key={process.id}
                    className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-blue-600">
                          {process.code}
                        </p>

                        <h4 className="mt-1 font-bold text-slate-950">
                          {process.name}
                        </h4>

                        <p className="mt-1 text-sm text-slate-500">
                          Active step: {process.activeStep}
                        </p>
                      </div>

                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClass[process.status]}`}
                      >
                        {statusLabel[process.status]}
                      </span>
                    </div>

                    <div className="mt-5">
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="text-slate-500">Progress</span>

                        <span className="font-semibold text-slate-900">
                          {progress}%
                        </span>
                      </div>

                      <div className="h-2 rounded-full bg-slate-100">
                        <div
                          className="h-2 rounded-full bg-blue-600"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>

                    <div className="mt-5 grid grid-cols-3 gap-3 text-center">
                      <SmallMetric label="Done" value={process.completed} />

                      <SmallMetric
                        label="Pending"
                        value={process.total - process.completed}
                      />

                      <SmallMetric label="Overdue" value={process.overdue} />
                    </div>
                  </article>
                )
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-200 p-5 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-950">
                  Step-Level Monitoring
                </h3>

                <p className="text-sm text-slate-500">
                  Base table layout for step, doer, assignment type, planned
                  time, actual time, delay, and status.
                </p>
              </div>

              <button className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                <UsersRound size={16} />
                View Assignments
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-4">Step No</th>
                    <th className="px-5 py-4">Step ID</th>
                    <th className="px-5 py-4">Step Name</th>
                    <th className="px-5 py-4">Assigned To</th>
                    <th className="px-5 py-4">Type</th>
                    <th className="px-5 py-4">Planned Time</th>
                    <th className="px-5 py-4">Actual Time</th>
                    <th className="px-5 py-4">Delay</th>
                    <th className="px-5 py-4">Status</th>
                    <th className="px-5 py-4">Action</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {steps.map((step) => (
                    <tr key={step.stepId} className="hover:bg-slate-50">
                      <td className="px-5 py-4 font-semibold text-slate-900">
                        {step.stepNo}
                      </td>

                      <td className="px-5 py-4 font-medium text-blue-700">
                        {step.stepId}
                      </td>

                      <td className="px-5 py-4 text-slate-700">
                        {step.stepName}
                      </td>

                      <td className="px-5 py-4 text-slate-700">
                        {step.assignedTo}
                      </td>

                      <td className="px-5 py-4 text-slate-700">
                        {step.assignmentType}
                      </td>

                      <td className="px-5 py-4 text-slate-700">
                        {step.plannedTime}
                      </td>

                      <td className="px-5 py-4 text-slate-700">
                        {step.actualTime}
                      </td>

                      <td className="px-5 py-4 text-slate-700">
                        {step.delay}
                      </td>

                      <td className="px-5 py-4">
                        <span
                          className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClass[step.status]}`}
                        >
                          {statusLabel[step.status]}
                        </span>
                      </td>

                      <td className="px-5 py-4">
                        <button className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700">
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </section>
    </main>
  )
}

function KpiCard({ icon, label, value }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="rounded-xl bg-blue-50 p-3 text-blue-700">{icon}</div>

        <p className="text-3xl font-bold text-slate-950">{value}</p>
      </div>

      <p className="mt-4 text-sm font-medium text-slate-500">{label}</p>
    </article>
  )
}

function SmallMetric({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-lg font-bold text-slate-950">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  )
}

export default App