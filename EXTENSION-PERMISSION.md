# Additional Permission for Extensions

VideoCull is licensed under the [GNU Affero General Public License, version 3](LICENSE) (AGPL-3.0). As permitted by section 7 of that license, the copyright holders of VideoCull give the following **additional permission**. It applies to VideoCull together with the AGPL-3.0, and to every contribution made to VideoCull while this permission is part of the project.

## Extensions

An **Extension** is a separate software module that:

1. works with VideoCull only through the extension interface that VideoCull publishes for that purpose (including the data VideoCull passes to the Extension and the results the Extension returns), and
2. does not contain, copy, or modify any other part of VideoCull's source code. Using the published interface definitions themselves is allowed.

You may combine VideoCull with an Extension, distribute the combined work (for example in the same installer or the same Microsoft Store package), and license the Extension under terms of your choice, including terms that are not open source. An Extension does not become subject to the AGPL-3.0 merely because it is combined with, loaded by, or exchanges data with VideoCull.

## What stays the same

- VideoCull itself, and any changes to it, remain licensed under the AGPL-3.0 as before. Whoever distributes VideoCull must still provide its source code as the AGPL-3.0 requires.
- Code that copies, patches, or goes beyond the published extension interface is not an Extension and stays under the AGPL-3.0.
- Reading or showing data from the user's library (such as a video's title) is not a reason for a module to count as part of VideoCull. Only reuse of VideoCull's code does.

## Removing this permission

As described in section 7 of the AGPL-3.0, you may remove this additional permission from your own copy of VideoCull, or from any part of it. The AGPL-3.0 then applies to that copy without the permission.
