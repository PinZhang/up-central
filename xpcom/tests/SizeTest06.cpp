// Test06.cpp

#include "nsIDOMWindowInternal.h"
#include "nsIScriptGlobalObject.h"
#include "nsIDocShell.h"
#include "nsIWebShellWindow.h"
#include "nsCOMPtr.h"

NS_DEF_PTR(nsIScriptGlobalObject);
NS_DEF_PTR(nsIWebShellWindow);

  /*
    Windows:
      nsCOMPtr_optimized           176
      nsCOMPtr_as_found            181
      nsCOMPtr_optimized*          182
      nsCOMPtr02*                  184
      nsCOMPtr02                   187
      nsCOMPtr02*                  188
      nsCOMPtr03                   189
      raw_optimized, nsCOMPtr00    191
      nsCOMPtr00*                  199
      nsCOMPtr_as_found*           201
      raw                          214

    Macintosh:
      nsCOMPtr_optimized           300    (1.0000)
      nsCOMPtr02                   320    (1.0667)  i.e., 6.67% bigger than nsCOMPtr_optimized
      nsCOMPtr00                   328    (1.0933)
      raw_optimized, nsCOMPtr03    332    (1.1067)
      nsCOMPtr_as_found            344    (1.1467)
      raw                          388    (1.2933)

  */


void // nsresult
Test06_raw(nsIDOMWindowInternal* aDOMWindow, nsIWebShellWindow** aWebShellWindow)
    // m388, w214
{
//  if (!aDOMWindow)
//    return NS_ERROR_NULL_POINTER;
  nsIScriptGlobalObject* scriptGlobalObject = 0;
  nsresult status = aDOMWindow->QueryInterface(NS_GET_IID(nsIScriptGlobalObject), (void**)&scriptGlobalObject);
  nsIDocShell* docShell = 0;
  if (scriptGlobalObject)
    scriptGlobalObject->GetDocShell(&docShell);
  nsIWebShell* rootWebShell = 0;
  NS_IF_RELEASE(rootWebShell);
  NS_IF_RELEASE(docShell);
  NS_IF_RELEASE(scriptGlobalObject);
//    return status;
}

void // nsresult
Test06_raw_optimized(nsIDOMWindowInternal* aDOMWindow, nsIWebShellWindow** aWebShellWindow)
    // m332, w191
{
//  if (!aDOMWindow)
//    return NS_ERROR_NULL_POINTER;
  (*aWebShellWindow) = 0;
  nsIScriptGlobalObject* scriptGlobalObject;
  nsresult status = aDOMWindow->QueryInterface(NS_GET_IID(nsIScriptGlobalObject), (void**)&scriptGlobalObject);
  if (NS_SUCCEEDED(status)) {
    nsIDocShell* docShell = 0;
    scriptGlobalObject->GetDocShell(&docShell);
    if (docShell) {
      NS_RELEASE(docShell);
    }
    NS_RELEASE(scriptGlobalObject);
  }
//  return status;
}

void
Test06_nsCOMPtr_as_found(nsIDOMWindowInternal* aDOMWindow, nsCOMPtr<nsIWebShellWindow>* aWebShellWindow)
    // m344, w181/201
{
//  if (!aDOMWindow)
//    return;
  nsCOMPtr<nsIScriptGlobalObject> scriptGlobalObject = do_QueryInterface(aDOMWindow);
  nsCOMPtr<nsIDocShell> docShell;
  if (scriptGlobalObject)
    scriptGlobalObject->GetDocShell(getter_AddRefs(docShell));  
}

void // nsresult
Test06_nsCOMPtr00(nsIDOMWindowInternal* aDOMWindow, nsIWebShellWindow** aWebShellWindow)
    // m328, w191/199
{
//  if (!aDOMWindow)
//    return NS_ERROR_NULL_POINTER;
  nsresult status;
  nsCOMPtr<nsIScriptGlobalObject> scriptGlobalObject = do_QueryInterface(aDOMWindow, &status);
  nsIDocShell* temp0 = 0;
  if (scriptGlobalObject)
    scriptGlobalObject->GetDocShell(&temp0);
  nsCOMPtr<nsIDocShell> docShell = dont_AddRef(temp0);
  (*aWebShellWindow) = 0;
//    return status;
}

void // nsresult
Test06_nsCOMPtr_optimized(nsIDOMWindowInternal* aDOMWindow, nsCOMPtr<nsIWebShellWindow>* aWebShellWindow)
    // m300, w176/182
{
//    if (!aDOMWindow)
//      return NS_ERROR_NULL_POINTER;
  nsresult status;
  nsCOMPtr<nsIScriptGlobalObject> scriptGlobalObject = do_QueryInterface(aDOMWindow, &status);
  nsIDocShell* temp0 = 0;
  if (scriptGlobalObject)
    scriptGlobalObject->GetDocShell(&temp0);
  (*aWebShellWindow) = do_QueryInterface(nsnull, &status);
//    return status;
}

void // nsresult
Test06_nsCOMPtr02(nsIDOMWindowInternal* aDOMWindow, nsIWebShellWindow** aWebShellWindow)
    // m320, w187/184
{
//    if (!aDOMWindow)
//      return NS_ERROR_NULL_POINTER;
  (*aWebShellWindow) = 0;
  nsresult status;
  nsCOMPtr<nsIScriptGlobalObject> scriptGlobalObject = do_QueryInterface(aDOMWindow, &status);
  if (scriptGlobalObject) {
    nsIDocShell* temp0;
    scriptGlobalObject->GetDocShell(&temp0);
  }
//    return status;
}

void // nsresult
Test06_nsCOMPtr03(nsIDOMWindowInternal* aDOMWindow, nsCOMPtr<nsIWebShellWindow>* aWebShellWindow)
    // m332, w189/188
{
//    if (!aDOMWindow)
//      return NS_ERROR_NULL_POINTER;
  (*aWebShellWindow) = 0;
  nsresult status;
  nsCOMPtr<nsIScriptGlobalObject> scriptGlobalObject = do_QueryInterface(aDOMWindow, &status);
  if (scriptGlobalObject) {
    nsIDocShell* temp0;
    scriptGlobalObject->GetDocShell(&temp0);
    nsCOMPtr<nsIDocShell> docShell = dont_AddRef(temp0);
    if (docShell) {
    }
  }
//    return status;
}
