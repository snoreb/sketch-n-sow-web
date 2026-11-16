using System;
using System.Collections;
using System.Collections.Generic;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

public class SketchWebsiteBridge : MonoBehaviour
{
    [SerializeField] private string serverUrl = "http://192.168.1.100:8787";
    [SerializeField] private bool sendToWebsite = true;
    [SerializeField] private string headsetLabel = "Headset";
    [SerializeField] private bool sendHeartbeat = true;
    private readonly Queue<string> pending = new Queue<string>();
    private readonly string runId = Guid.NewGuid().ToString("N");
    private bool isSending;
    private bool? lastHeartbeatSucceeded;

    [Serializable]
    public class HeartbeatSnapshot
    {
        public int schemaVersion = 1;
        public string clientId;
        public string label;
        public string deviceKind;
    }

    private void OnEnable()
    {
        lastHeartbeatSucceeded = null;
        StartCoroutine(SendHeartbeats());
    }

    private IEnumerator SendHeartbeats()
    {
        while (true)
        {
            if (sendHeartbeat)
            {
                var heartbeat = new HeartbeatSnapshot
                {
                    clientId = runId,
                    label = string.IsNullOrWhiteSpace(headsetLabel) ? "Headset" : headsetLabel.Trim(),
                    deviceKind = Application.isEditor ? "editor" : "headset"
                };
                string endpoint = (serverUrl ?? "").Trim().TrimEnd('/') + "/api/heartbeat";
                bool succeeded = false;
                string failure = "";
                UnityWebRequest request = null;
                UnityWebRequestAsyncOperation operation = null;
                try
                {
                    request = new UnityWebRequest(endpoint, "POST");
                    request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(JsonUtility.ToJson(heartbeat)));
                    request.downloadHandler = new DownloadHandlerBuffer();
                    request.SetRequestHeader("Content-Type", "application/json");
                    request.timeout = 5;
                    operation = request.SendWebRequest();
                }
                catch (Exception exception)
                {
                    failure = exception.Message;
                }

                using (request)
                {
                    if (operation != null)
                    {
                        yield return operation;
                        succeeded = request.result == UnityWebRequest.Result.Success;
                        failure = request.error + " " + request.downloadHandler.text;
                    }
                }

                if (lastHeartbeatSucceeded != succeeded)
                {
                    if (succeeded)
                        Debug.Log("Sketch website heartbeat connected: " + endpoint);
                    else
                        Debug.LogWarning("Sketch website heartbeat failed: " + endpoint + " — " + failure);
                }
                lastHeartbeatSucceeded = succeeded;
            }
            yield return new WaitForSecondsRealtime(5f);
        }
    }

    [Serializable]
    public class SketchSnapshot
    {
        public int schemaVersion = 1;
        public string id;
        public string title;
        public string coordinates = "unity-left-handed-y-up";
        public string source = "headset";
        public StrokeSnapshot[] strokes;
    }

    [Serializable]
    public class StrokeSnapshot
    {
        public Vector3[] points;
        public float[] widths;
        public Color color;
        public Color[] colors;
        public bool loop;
    }

    public void Capture(ulong ideaId, List<NetworkLine> lines)
    {
        if (!sendToWebsite || !isActiveAndEnabled) return;
        if (pending.Count >= 10)
        {
            Debug.LogWarning("Sketch website queue is full; this snapshot was skipped.");
            return;
        }

        var strokes = new List<StrokeSnapshot>();
        var bounds = new Bounds();
        bool hasBounds = false;
        int pointCount = 0;
        foreach (NetworkLine networkLine in lines)
        {
            if (networkLine == null || !networkLine.TryGetComponent(out LineRenderer renderer)) continue;
            int count = renderer.positionCount;
            if (count == 0) continue;
            pointCount += count;
            if (pointCount > 30000 || strokes.Count >= 1000)
            {
                Debug.LogWarning("Sketch exceeds the website prototype's geometry limit; snapshot skipped.");
                return;
            }

            var stroke = new StrokeSnapshot
            {
                points = new Vector3[count],
                widths = new float[count],
                colors = new Color[count],
                color = networkLine.NetColor.Value,
                loop = renderer.loop
            };
            renderer.GetPositions(stroke.points);
            AnimationCurve widthCurve = renderer.widthCurve;
            Gradient colorGradient = renderer.colorGradient;
            for (int pointIndex = 0; pointIndex < count; pointIndex++)
            {
                Vector3 point = renderer.useWorldSpace
                    ? stroke.points[pointIndex]
                    : renderer.transform.TransformPoint(stroke.points[pointIndex]);
                stroke.points[pointIndex] = point;
                if (!hasBounds)
                {
                    bounds = new Bounds(point, Vector3.zero);
                    hasBounds = true;
                }
                else bounds.Encapsulate(point);
                float progress = count == 1 ? 0f : pointIndex / (float)(count - 1);
                stroke.widths[pointIndex] = Mathf.Max(0f, widthCurve.Evaluate(progress) * renderer.widthMultiplier);
                stroke.colors[pointIndex] = colorGradient.Evaluate(progress) * networkLine.NetColor.Value;
            }
            strokes.Add(stroke);
        }

        foreach (StrokeSnapshot stroke in strokes)
            for (int pointIndex = 0; pointIndex < stroke.points.Length; pointIndex++)
                stroke.points[pointIndex] -= bounds.center;

        var snapshot = new SketchSnapshot
        {
            id = runId + "-" + ideaId,
            title = "Idea " + ideaId,
            strokes = strokes.ToArray()
        };
        pending.Enqueue(JsonUtility.ToJson(snapshot));
        if (!isSending) StartCoroutine(SendPending());
    }

    private IEnumerator SendPending()
    {
        isSending = true;
        while (pending.Count > 0)
        {
            string json = pending.Dequeue();
            bool delivered = false;
            string lastError = "";
            for (int attempt = 0; attempt < 3; attempt++)
            {
                using (var request = new UnityWebRequest(serverUrl.TrimEnd('/') + "/api/sketches", "POST"))
                {
                    request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
                    request.downloadHandler = new DownloadHandlerBuffer();
                    request.SetRequestHeader("Content-Type", "application/json");
                    request.timeout = 5;
                    yield return request.SendWebRequest();
                    delivered = request.result == UnityWebRequest.Result.Success;
                    lastError = request.error + " " + request.downloadHandler.text;
                    if (delivered || (request.responseCode >= 400 && request.responseCode < 500)) break;
                }
                yield return new WaitForSecondsRealtime(1f + attempt);
            }
            if (!delivered) Debug.LogWarning("Sketch website snapshot could not be sent: " + lastError);
        }
        isSending = false;
    }

    private void OnDisable()
    {
        StopAllCoroutines();
        pending.Clear();
        isSending = false;
    }
}
