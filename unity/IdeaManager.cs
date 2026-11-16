using System.Collections.Generic;
using Unity.Netcode;
using UnityEngine;
using Unity.Collections;
using TMPro;


public class IdeaManager : NetworkBehaviour // Changed to NetworkBehaviour
{
   [Header("Setup")]
   [SerializeField] private OVRHand leftHand;
   [SerializeField] private OVRHand rightHand;
   [SerializeField] private IdeaDataHandler ideaPrefab;
   [SerializeField] private GameObject beePrefab;
   [SerializeField] private GameObject ideaHolderPrefab;


   //[SerializeField] private float ideaScale = 0.1f;
   [SerializeField] private LineDrawing lineDrawingScript;
   [SerializeField] private MXInkVoiceHandler voiceHandler;
   [SerializeField] private GameObject linesHolderPrefab;


   [SerializeField] private StylusHandler _stylusHandler;

   [SerializeField] private SketchWebsiteBridge websiteBridge;




   private bool _isPinching;
   private bool _isLeftPinching;
   private bool _isRightPinching;


   private bool _wasPinching;
   private GameLogic gameLogic;


   private bool wasHolding = false;
   private GameObject currentIdea;
   private OVRCameraRig cameraRig;


   private void Start()
   {
       gameLogic = FindAnyObjectByType<GameLogic>();
       cameraRig = FindObjectOfType<OVRCameraRig>();
   }


   void Update()
   {
       // 1. Safety check for VR tracking
       //if (!leftHand.IsTracked) return;


       //_isLeftPinching = leftHand.GetFingerIsPinching(OVRHand.HandFinger.Index);
       //_isRightPinching = rightHand.GetFingerIsPinching(OVRHand.HandFinger.Middle);


       //bool anyHandPinching = _isLeftPinching || _isRightPinching;


       bool isHolding = _stylusHandler.CurrentState.cluster_back_value;






       Vector3 worldPointerPos = _stylusHandler.CurrentState.inkingPose.position;
       Quaternion worldPointerRot = _stylusHandler.CurrentState.inkingPose.rotation;


       if (isHolding && !wasHolding && !gameLogic.GetGroupRanking())
       {
           Quaternion spawnRotation =
               worldPointerRot * Quaternion.Euler(0f, 90f, 0f);


           currentIdea = Instantiate(
               ideaPrefab.gameObject,
               worldPointerPos,
               spawnRotation
           );
       }


       if (isHolding && !wasHolding && gameLogic.GetGroupRanking())
       {
           currentIdea = Instantiate(beePrefab.gameObject, worldPointerPos, worldPointerRot);
       }


       if (isHolding && currentIdea != null)
       {
           currentIdea.transform.position = worldPointerPos;
           if (!gameLogic.GetGroupRanking())
           {
               currentIdea.transform.rotation =
                   worldPointerRot * Quaternion.Euler(0f, -90f, 0f);
           }
           else
           {
               currentIdea.transform.rotation = worldPointerRot;
           }
       }


       if (!isHolding && wasHolding)
       {
           Destroy(currentIdea);
           currentIdea = null;


           /*
      OVRHand triggeringHand = _isRightPinching ? rightHand : leftHand;


      // 2. Safety check for Zipper
      if (IsPinchingInsideZipperCube(triggeringHand))
      {
          _wasPinching = true; // Mark as pinching so we don't re-trigger
          return;
      }


      */


           // 2. GET WORLD POSITION
           // We need the TrackingSpace to turn the local Hand Pose into a real World Position
           //OVRCameraRig cameraRig = FindObjectOfType<OVRCameraRig>();


           //Vector3 worldPointerPos = cameraRig.trackingSpace.TransformPoint(triggeringHand.PointerPose.position);
           //Quaternion worldPointerRot = cameraRig.trackingSpace.rotation * triggeringHand.PointerPose.rotation;




           // 3. CONVERT TO ANCHOR SPACE (The "Universal Language")
           GameObject anchor = GameObject.FindWithTag("SharedAnchor");


           Vector3 sendPos = worldPointerPos;


           Quaternion sendRot = !gameLogic.GetGroupRanking()
               ? worldPointerRot * Quaternion.Euler(0f, -90f, 0f)
               : worldPointerRot;


           if (anchor != null)
           {
               sendPos = anchor.transform.InverseTransformPoint(worldPointerPos);
               sendRot = Quaternion.Inverse(anchor.transform.rotation) * sendRot;
           }


           if (!gameLogic.GetGroupRanking())
           {
               // Line Logic
               var allLines = lineDrawingScript.GetAllFinishedLines();
               List<ulong> lineIds = new List<ulong>();
               foreach (var line in allLines) lineIds.Add(line.NetworkObjectId);
               lineDrawingScript.ResetLineList();


               var notesWithTransforms = voiceHandler.GetAllIdeaNotesWithTransforms();


               // Convert to anchor space for sending over network
               List<FixedString512Bytes> noteTexts = new List<FixedString512Bytes>();
               List<Vector3> notePositions = new List<Vector3>();
               List<Quaternion> noteRotations = new List<Quaternion>();




               foreach (var (text, pos, rot) in notesWithTransforms)
               {
                   noteTexts.Add(new FixedString512Bytes(text));
                   // Convert to anchor space
                   Vector3 anchorPos = anchor != null ? anchor.transform.InverseTransformPoint(pos) : pos;
                   Quaternion anchorRot = anchor != null ? Quaternion.Inverse(anchor.transform.rotation) * rot : rot;
                   notePositions.Add(anchorPos);
                   noteRotations.Add(anchorRot);
               }


               RequestSpawnCubeServerRpc(
                   sendPos, sendRot,
                   lineIds.ToArray(),
                   noteTexts.ToArray(),
                   notePositions.ToArray(),
                   noteRotations.ToArray()
               );
               gameLogic?.IncreaseIdeaCounter();
           }
           else
           {
               SpawnBeeServerRPC(sendPos, sendRot);
           }
       }


       wasHolding = isHolding;


       //_wasPinching = anyHandPinching;
   }


   private bool IsPinchingInsideZipperCube(OVRHand hand)
   {
       Vector3 pinchPos = hand.PointerPose.position;


       // Check all colliders at pinch position
       Collider[] colliders = Physics.OverlapSphere(pinchPos, 0.01f);
       foreach (var col in colliders)
       {
           if (col.CompareTag("ZipperCube") && col.isTrigger)
               return true;
       }
       return false;
   }


   [ServerRpc(RequireOwnership = false)]
   void RequestSpawnCubeServerRpc(Vector3 localPos, Quaternion localRot, ulong[] lineIds,
   FixedString512Bytes[] notes, Vector3[] noteLocalPositions, Quaternion[] noteLocalRotations,
   ServerRpcParams rpcParams = default)
   {
       Debug.Log($"Server received {lineIds.Length} line IDs");






       // 5. TRANSLATE BACK TO WORLD SPACE ON SERVER
       GameObject anchor = GameObject.FindWithTag("SharedAnchor");
       Vector3 spawnWorldPos = localPos;
       Quaternion spawnWorldRot = localRot;


       if (anchor != null)
       {
           // "Put this at the world spot that matches the local offset provided by the client"
           spawnWorldPos = anchor.transform.TransformPoint(localPos);
           spawnWorldRot = anchor.transform.rotation * localRot;
       }


       // 6. SPAWN AND GIVE OWNERSHIP
       GameObject newIdea = Instantiate(ideaPrefab.gameObject, spawnWorldPos, spawnWorldRot);
       NetworkObject netObj = newIdea.GetComponent<NetworkObject>();


       // CRITICAL: Since you use ClientNetworkTransform, the Client MUST own it
       // to move it. SpawnWithOwnership prevents the "snap back to origin" bug.
       //netObj.SpawnWithOwnership(rpcParams.Receive.SenderClientId);
       netObj.Spawn();


       GameObject ideaHolder = Instantiate(ideaHolderPrefab, spawnWorldPos, spawnWorldRot);
       NetworkObject holderNetObj = ideaHolder.GetComponent<NetworkObject>();
       holderNetObj.Spawn();
       holderNetObj.TrySetParent(netObj, true);


       SeedPourer pourer = newIdea.GetComponentInChildren<SeedPourer>();


       if (pourer != null)
       {
           pourer.assignedHolder = holderNetObj;
           Debug.Log("Assigned holder to SeedPourer");
       }
       else
       {
           Debug.LogWarning("No SeedPourer found on idea cube!");
       }


       IdeaDataHandler handler = newIdea.GetComponent<IdeaDataHandler>();
       //handler.ParentToAnchorClientRpc();
       // Spawn note
       List<ulong> noteNetworkIds = new List<ulong>();
       for (int i = 0; i < notes.Length; i++)
       {
           string noteText = notes[i].ToString();
           if (!string.IsNullOrEmpty(noteText))
           {
               // Convert anchor space back to world space
               Vector3 noteWorldPos = anchor != null
                   ? anchor.transform.TransformPoint(noteLocalPositions[i])
                   : noteLocalPositions[i];
               Quaternion noteWorldRot = anchor != null
                   ? anchor.transform.rotation * noteLocalRotations[i]
                   : noteLocalRotations[i];


               GameObject noteObj = Instantiate(handler.GetNotePrefab(), noteWorldPos, noteWorldRot);
               //noteObj.GetComponent<TextMeshPro>().text = noteText;
               NetworkObject noteNetObj = noteObj.GetComponent<NetworkObject>();
               noteNetObj.Spawn();


               if (noteObj.TryGetComponent<NoteSync>(out var sync))
               {
                   sync.NoteText.Value = notes[i];
               }


               noteNetObj.TrySetParent(holderNetObj, true);
               noteNetworkIds.Add(noteNetObj.NetworkObjectId);
           }
       }


       // 1. Calculate Group Center first
       Vector3 groupCenter = Vector3.zero;
       int totalPoints = 0;


       List<NetworkLine> lineScripts = new List<NetworkLine>();


       foreach (ulong id in lineIds)
       {
           if (NetworkManager.Singleton.SpawnManager.SpawnedObjects.TryGetValue(id, out var lineObj))
           {
               if (lineObj.TryGetComponent<NetworkLine>(out var netLine))
               {
                   lineScripts.Add(netLine);
                   foreach (Vector3 p in netLine.GetPoints())
                   {
                       groupCenter += p;
                       totalPoints++;
                   }
               }
           }
       }


       if (totalPoints > 0) groupCenter /= totalPoints;

       if (websiteBridge != null)
           websiteBridge.Capture(netObj.NetworkObjectId, lineScripts);




       // 2. Spawn the linesHolder at the DRAWING PLACEMENT, not the pinch pos
       //Transform placement = handler.GetLinePlacement().transform;
       GameObject linesHolder = Instantiate(linesHolderPrefab, groupCenter, Quaternion.identity);


       NetworkObject linesHolderNetObj = linesHolder.GetComponent<NetworkObject>();
       linesHolderNetObj.Spawn();


       // 3. Parent the holder to the placement transform
       // Using 'false' here snaps the holder to the placement's (0,0,0)
       linesHolderNetObj.TrySetParent(holderNetObj, true);
       //linesHolder.transform.SetParent(placement, true);




       foreach (var netLine in lineScripts)
       {
           NetworkObject lineNetObj = netLine.GetComponent<NetworkObject>();
           lineNetObj.ChangeOwnership(NetworkManager.ServerClientId);
           lineNetObj.TrySetParent(linesHolderNetObj, true);


           // This is the magic part:
           // We set the local position to the difference between
           // the original line's position and the group center.
           // This keeps the smiley features relative to each other!


           // ============== THIS IS WHAT NEEDS TO BE FIXED => HERE ==========================================================================
           //netLine.SetRelativePositionClientRpc(groupCenter, 0.7f);
       }






       // Single RPC — sets everything up
       handler.InitializeIdeaClientRpc(holderNetObj.NetworkObjectId, linesHolderNetObj.NetworkObjectId, noteNetworkIds.ToArray(), notes);
   }




   [ServerRpc(RequireOwnership = false)]
   private void SpawnBeeServerRPC(Vector3 localPos, Quaternion localRot)
   {
       GameObject anchor = GameObject.FindWithTag("SharedAnchor");
       Vector3 spawnWorldPos = localPos;
       Quaternion spawnWorldRot = localRot;


       if (anchor != null)
       {
           spawnWorldPos = anchor.transform.TransformPoint(localPos);
           spawnWorldRot = anchor.transform.rotation * localRot;
       }


       GameObject newBee = Instantiate(beePrefab, spawnWorldPos, spawnWorldRot);
       newBee.GetComponent<BeeMovement>().IsMoving.Value = true;
       NetworkObject netObj = newBee.GetComponent<NetworkObject>();
       netObj.Spawn();
   }


}
