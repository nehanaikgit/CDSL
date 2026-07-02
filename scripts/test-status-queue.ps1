param(
  [string]$ProcessCode = "ST_BOD_FMS",
  [Parameter(Mandatory = $true)]
  [string]$StepId,
  [string]$Status = "File Downloaded",
  [string]$ChangedBy = "nehanaik@geplcapital.com",
  [string]$Remark = "Async queue smoke test",
  [string]$BaseUrl = "http://localhost:5001"
)

$body = @{
  status     = $Status
  changed_by = $ChangedBy
  remark     = $Remark
} | ConvertTo-Json

$timer = [System.Diagnostics.Stopwatch]::StartNew()
$response = Invoke-RestMethod `
  -Uri "$BaseUrl/api/process/$ProcessCode/steps/$StepId/status" `
  -Method PATCH `
  -ContentType "application/json" `
  -Body $body
$timer.Stop()

Write-Host "PATCH response: $($timer.ElapsedMilliseconds) ms"
$response | ConvertTo-Json -Depth 10

$jobId = $response.data.job_id
if (-not $jobId) {
  Write-Host "Synchronous fallback completed; no queue job was returned."
  exit 0
}

for ($attempt = 1; $attempt -le 80; $attempt++) {
  Start-Sleep -Milliseconds 1000

  $job = Invoke-RestMethod `
    -Uri "$BaseUrl/api/process/status-updates/$jobId" `
    -Method GET

  Write-Host "[$attempt] $($job.data.status)"

  if ($job.data.status -eq "COMPLETED") {
    Write-Host "BigQuery commit confirmed."
    $job | ConvertTo-Json -Depth 10
    exit 0
  }

  if ($job.data.status -eq "FAILED") {
    Write-Host "Queue job failed."
    $job | ConvertTo-Json -Depth 10
    exit 1
  }
}

Write-Host "The job did not reach a terminal state within 80 seconds."
exit 2
